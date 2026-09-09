import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseArgs } from "../src/args";
import { autoDesktop, autoTask } from "../src/auto-login";
import { autoCron, autoPlist } from "../src/auto-start";
import { readAuto, runAuto, saveAuto, syncAuto } from "../src/auto-update";
import { patchLock, readState } from "../src/patch-state";

let root = "";
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});
async function fixture() {
  root = await mkdtemp(resolve("luon-temp/auto-update-"));
  return root;
}

test("auto settings default to off and persist only after scheduler success", async () => {
  await fixture();
  expect(await readAuto(root)).toEqual({ active: false, hours: 6, apps: true });
  const config = { active: true, hours: 1, apps: false };
  await expect(saveAuto(config, { root,
    startup: async () => { throw new Error("Scheduler unavailable"); },
  })).rejects.toThrow("Scheduler unavailable");
  expect((await readAuto(root)).active).toBe(false);
  let active = false;
  await saveAuto(config, { root, startup: async value => { active = value; } });
  expect(active).toBe(true);
  expect(await readAuto(root)).toEqual(config);
  await saveAuto({ ...config, active: false }, {
    root, startup: async value => { active = value; },
  });
  expect(active).toBe(false);
  await expect(saveAuto({ ...config, hours: 0 }, { root }))
    .rejects.toThrow("Invalid update settings");
});

test("disabled and early runs do not update or postpone the due time", async () => {
  await fixture();
  let calls = 0;
  const apply = async () => { calls++; };
  await runAuto({ random: () => 0, root, now: 100, apply });
  expect(calls).toBe(0);
  await Bun.write(join(root, "auto.json"), JSON.stringify({
    active: true, hours: 6, apps: true,
  }));
  await Bun.write(join(root, "auto-state.json"), JSON.stringify({ next: 200 }));
  await runAuto({ random: () => 0, root, now: 100, apply });
  expect(calls).toBe(0);
  expect(await readState(join(root, "auto-state.json"))).toEqual({ next: 200 });
  await runAuto({ random: () => 0, root, now: 200, apply });
  expect(calls).toBe(1);
  expect(await readState(join(root, "auto-state.json")))
    .toEqual({ next: 200 + 6 * 3_600_000 });
});

test("concurrent scheduled runs apply once and release locks after failure", async () => {
  await fixture();
  await Bun.write(join(root, "auto.json"), JSON.stringify({
    active: true, hours: 1, apps: true,
  }));
  const started = Promise.withResolvers<void>();
  const done = Promise.withResolvers<void>();
  let calls = 0;
  const first = runAuto({ random: () => 0, root, now: 100, apply: async () => {
    calls++; started.resolve(); await done.promise;
  } });
  await started.promise;
  await runAuto({ random: () => 0, root, now: 100, apply: async () => { calls++; } });
  done.resolve();
  await first;
  expect(calls).toBe(1);
  await expect(runAuto({ random: () => 0, root, now: 100 + 3_600_000,
    apply: async () => { throw new Error("Offline"); },
  })).rejects.toThrow("Offline");
  expect(await Bun.file(join(root, "auto-run.lock")).exists()).toBe(false);
});

test("CLI accepts the two exclusive window options", () => {
  expect(parseArgs(["update", "--auto"]).auto).toBe(true);
  expect(parseArgs(["update", "--check"]).check).toBe(true);
  expect(parseArgs(["update", "--auto-run"]).autoRun).toBe(true);
  expect(() => parseArgs(["update", "--auto", "--check"])).toThrow();
});

test("scheduler definitions preserve other cron jobs and escape paths", () => {
  const command = ["/home/a b/bun", "/home/a b/luon", "update", "--auto-run"];
  const original = "# existing\n0 2 * * * backup\n";
  const cron = autoCron(original, command, true, "/home/a b/update.log");
  expect(cron).toContain(original.trim());
  expect(cron).toContain("@reboot ");
  expect(cron).toContain("'/home/a b/bun'");
  expect(autoCron(cron, command, true, "/home/a b/update.log")).toBe(cron);
  expect(autoCron(cron, command, false, "")).toBe(original);
  const plist = autoPlist(["/a&b/bun", ...command.slice(1)], "/a&b/log");
  expect(plist).toContain("/a&amp;b/bun");
  expect(plist).toContain("<key>RunAtLoad</key><true/>");
  expect(plist).toContain("<key>StartInterval</key><integer>60</integer>");
});

test("startup after a day runs once and keeps the configured interval", async () => {
  await fixture();
  await Bun.write(join(root, "auto.json"), JSON.stringify({
    active: true, hours: 6, apps: false,
  }));
  await Bun.write(join(root, "auto-state.json"), JSON.stringify({ next: 100 }));
  const now = 100 + 24 * 3_600_000;
  let calls = 0;
  const apply = async config => {
    expect(config.apps).toBe(false);
    calls++;
  };
  await runAuto({ random: () => 0, root, now, apply });
  await runAuto({ random: () => 0, root, now: now + 1, apply });
  expect(calls).toBe(1);
  expect(await readState(join(root, "auto-state.json")))
    .toEqual({ next: now + 6 * 3_600_000 });
});

test("startup does not install while settings registration is in progress", async () => {
  await fixture();
  await Bun.write(join(root, "auto.json"), JSON.stringify({ active: true }));
  const unlock = await patchLock("auto-settings", root);
  let calls = 0;
  try {
    await runAuto({ random: () => 0, root, apply: async () => { calls++; } });
    expect(calls).toBe(0);
    expect(await readState(join(root, "auto-state.json"))).toBeUndefined();
  } finally { await unlock?.(); }
});

test("login migration is opt-in, once only, and preserves due time", async () => {
  await fixture();
  let calls = 0;
  const startup = async (active: boolean, upgrade?: boolean) => {
    expect(active).toBe(true);
    expect(upgrade).toBe(true);
    calls++;
  };
  await syncAuto({ root, startup });
  expect(calls).toBe(0);
  await Bun.write(join(root, "auto.json"), JSON.stringify({ active: true }));
  await Bun.write(join(root, "auto-state.json"), JSON.stringify({ next: 100 }));
  await expect(syncAuto({ root, startup: async () => {
    throw new Error("Registration failed");
  } })).rejects.toThrow("Registration failed");
  await syncAuto({ root, startup });
  await syncAuto({ root, startup });
  expect(calls).toBe(1);
  expect(await readState(join(root, "auto-state.json"))).toEqual({ next: 100 });
});

test("Windows task has current-user login and minutely triggers", () => {
  const task = autoTask(["C:\\Program Files\\bun.exe",
    "C:\\Users\\A&B\\luon.ts", "update", "--auto-run"], "S-1-5-21-123",
    "2026-09-09T00:00:00.000Z");
  expect(task).toContain("<TimeTrigger>");
  expect(task).toContain("<Interval>PT1M</Interval>");
  expect(task).toContain("<LogonTrigger><Enabled>true</Enabled>");
  expect(task).toContain("<UserId>S-1-5-21-123</UserId>");
  expect(task).toContain("<LogonType>InteractiveToken</LogonType>");
  expect(task).toContain("<RunLevel>LeastPrivilege</RunLevel>");
  expect(task).toContain("A&amp;B");
  expect(task).toContain("<MultipleInstancesPolicy>IgnoreNew");
  const desktop = autoDesktop("/home/a b/.luon/updates/auto-login.sh");
  expect(desktop).toContain('Exec=/bin/sh "/home/a b/.luon/updates/auto-login.sh"');
  expect(desktop).toContain("Terminal=false");
  expect(autoDesktop("/home/a%/job")).toContain("a%%");
});
