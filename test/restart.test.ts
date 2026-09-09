import { expect, test } from "bun:test";
import { createGate, restartGate } from "@luon/runtime/restart";
import { updatePolicy } from "@luon/runtime/update-policy";
import { resolvePolicy, restartSlot, userPolicy } from "../src/restart-policy";
import { prepareRestart } from "../src/restart-watch";
import { autoPage } from "../src/auto-dialog";

test("nested work blocks restart and committing restart rejects new work", () => {
  const gate = createGate();
  gate.lock(); gate.lock();
  expect(gate.begin()).toBe(false);
  gate.unlock();
  expect(gate.begin()).toBe(false);
  gate.unlock();
  expect(gate.begin()).toBe(true);
  expect(() => gate.lock()).toThrow("restarting");
  gate.cancel(); gate.lock(); gate.unlock();
  expect(() => gate.unlock()).toThrow("matching");
});

test("user choices override app defaults and validate clocks", () => {
  expect(resolvePolicy(undefined, {}).apply).toBe("next-launch");
  expect(resolvePolicy({ apply: "restart" }, { apply: "next-launch" }).apply)
    .toBe("next-launch");
  expect(resolvePolicy({ apply: "restart" }, { apply: "next-launch" },
    { apply: "restart", at: "03:00", spread: 15 }))
    .toEqual({ apply: "restart", at: "03:00", spread: 15 });
  expect(userPolicy({ apply: "default" })).toEqual({ apply: "default" });
  for (const value of [{ at: "25:00" }, { spread: 0 }, { apply: "force" }]) {
    expect(() => updatePolicy(value)).toThrow();
  }
});

test("device and app times spread inside the window, including midnight", () => {
  const policy = { apply: "restart" as const, at: "05:00", spread: 30 };
  const date = new Date(2026, 8, 10, 5, 10);
  const a = restartSlot(date, policy, "device-a", "app-one")!;
  expect(restartSlot(date, policy, "device-a", "app-one")).toEqual(a);
  expect(restartSlot(date, policy, "device-b", "app-one")!.due).not.toBe(a.due);
  expect(restartSlot(date, policy, "device-a", "app-two")!.due).not.toBe(a.due);
  expect(a.due).toBeGreaterThanOrEqual(new Date(2026, 8, 10, 5).getTime());
  expect(a.due).toBeLessThan(a.end);
  expect(restartSlot(new Date(2026, 8, 10, 6), policy, "a", "b"))
    .toBeUndefined();
  expect(restartSlot(new Date(2026, 8, 11, 0, 10),
    { ...policy, at: "23:50" }, "a", "b")).toBeDefined();
});

test("restart preparation rolls back page gates when another page is busy", async () => {
  const gates = new Map([["", createGate()], ["one", createGate()]]);
  gates.get("one")!.lock();
  const call = async (method: string, args: any): Promise<any> => {
    if (method === "tabs.list") return [{ id: "one" }];
    const gate = gates.get(args.id)!;
    return args.expression.includes("begin") ? gate.begin() : gate.cancel();
  };
  expect(await prepareRestart(call, true)).toBeUndefined();
  expect(gates.get("")!.status().restarting).toBe(false);
  expect(restartGate().status().restarting).toBe(false);
  gates.get("one")!.unlock();
  const cancel = await prepareRestart(call, true);
  expect(cancel).toBeFunction();
  expect(() => gates.get("")!.lock()).toThrow();
  await cancel!();
  expect(gates.get("")!.status().restarting).toBe(false);
});

test("unsupported legacy pages never approve restart", async () => {
  expect(await prepareRestart(async () => null)).toBeUndefined();
  expect(restartGate().status().restarting).toBe(false);
});

test("settings script compiles and renders explicit per-app choices", () => {
  const page = autoPage({ active: true, hours: 6, apps: true,
    restart: { apply: "restart", at: "05:00", spread: 30 } }, "test", [
    { id: "app-one", title: '<img src=x onerror="bad">', state: "scheduled" },
  ]);
  expect(page).toContain('value="05:00"');
  expect(page).toContain("Next launch only");
  expect(page).not.toContain('<img src=x');
  const script = page.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  if (!script) throw new Error("Settings script is missing.");
  expect(() => new Function(script)).not.toThrow();
});

test("downloaded updates wait for unlock and respect a late user opt-out", async () => {
  const { mkdtemp, mkdir, rm } = await import("node:fs/promises");
  const { join, resolve } = await import("node:path");
  const { writeLuon } = await import("@luon/runtime/luon-file");
  const { watchRestart } = await import("../src/restart-watch");
  const root = await mkdtemp(resolve("luon-temp/restart-flow-"));
  const settings = join(root, "settings");
  await mkdir(settings);
  const config = { active: true, apps: true, hours: 6,
    restart: { apply: "restart", at: "05:00", spread: 1 } };
  await Bun.write(join(settings, "auto.json"), JSON.stringify(config));
  const manifest = { format: 1 as const, id: "app-test", type: "app" as const,
    title: "Test", name: "test", runtime: "0.1.88", version: "1",
    createdAt: new Date().toISOString(), mode: "static" as const,
    data: "local" as const, database: false };
  await Bun.write(join(root, "launch.luon"), await writeLuon({
    manifest: { ...manifest, version: "2" },
    files: new Map([["site/index.html", new File(["new"], "index.html")]]),
  }));
  const gate = createGate();
  gate.lock();
  let closed = 0, requested = 0;
  let now = new Date(2026, 8, 10, 5, 0, 46).getTime();
  const child = { pid: 123, reused: false, stderr: null,
    exited: new Promise<number>(() => {}),
    call: async (_method: string, args: any) =>
      args.expression.includes("begin") ? gate.begin() : gate.cancel(),
  };
  const watcher = watchRestart(manifest, root, child, () => requested++, {
    root: settings, now: () => now, close: () => { closed++; },
  });
  try {
    await watcher.check();
    expect(closed).toBe(0);
    gate.unlock();
    // The first window has ended: unlocking must not trigger late restart.
    now = new Date(2026, 8, 10, 6).getTime();
    await watcher.check(); expect(closed).toBe(0);
    now = new Date(2026, 8, 11, 5, 0, 59).getTime();
    config.restart.apply = "next-launch";
    await Bun.write(join(settings, "auto.json"), JSON.stringify(config));
    await watcher.check(); expect(closed).toBe(0);
    config.restart.apply = "restart";
    await Bun.write(join(settings, "auto.json"), JSON.stringify(config));
    await watcher.check();
    expect(closed).toBe(1); expect(requested).toBe(1);
    expect(() => gate.lock()).toThrow("restarting");
  } finally {
    await watcher.stop(); restartGate().cancel();
    await rm(root, { recursive: true, force: true });
  }
});
