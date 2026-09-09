import { mkdir, stat } from "node:fs/promises";
import { join } from "node:path";
import type { ViewProcess } from "@luon/webview";
import { controlView } from "@luon/webview";
import { readLuon, type LuonManifest } from "@luon/runtime/luon-file";
import { restartGate } from "@luon/runtime/restart";
import { readAuto } from "./auto-update";
import { deviceSeed, resolvePolicy, restartSlot } from "./restart-policy";
import { patchRoot, writeState } from "./patch-state";

export async function prepareRestart(call: NonNullable<ViewProcess["call"]>,
  browser = false) {
  const gates: string[] = [];
  const invoke = (id: string, method: string) => call("tabs.evaluate", {
    id, expression: `globalThis[Symbol.for("@luon/restart")]?.${method}()`,
  });
  const cancel = async () => {
    for (const id of gates) await invoke(id, "cancel").catch(() => {});
    restartGate().cancel();
  };
  if (!restartGate().begin()) return;
  try {
    const tabs = browser
      ? [{ id: "" }, ...await call("tabs.list", {}) as Array<{ id: string }>]
      : [{ id: "" }];
    if (!Array.isArray(tabs) || !tabs.length) throw Error("No app page ready.");
    for (const tab of tabs) {
      if (await invoke(tab.id, "begin") !== true) {
        throw Error("App is locked or does not support managed restart.");
      }
      gates.push(tab.id);
    }
    const latest = browser
      ? [{ id: "" }, ...await call("tabs.list", {}) as Array<{ id: string }>]
      : [{ id: "" }];
    if (latest.length !== gates.length
      || latest.some(tab => !gates.includes(tab.id))) {
      throw Error("App windows changed during restart preparation.");
    }
    return cancel;
  } catch { await cancel(); }
}

export function watchRestart(pkg: LuonManifest, root: string,
  child: ViewProcess, requested: () => void, options: {
    root?: string; now?: () => number; close?: typeof controlView;
  } = {}) {
  const stateRoot = options.root ?? patchRoot;
  const now = options.now ?? Date.now;
  let stopped = false;
  let busy = false;
  let stamp = "";
  let pending: LuonManifest | undefined;
  let retry = 0;
  const folder = join(stateRoot, "running");
  const status = async (state: string) => {
    await mkdir(folder, { recursive: true, mode: 0o700 });
    await writeState(join(folder, `${process.pid}.json`), {
      id: pkg.id, title: pkg.title, pid: process.pid,
      version: pkg.version, pending: pending?.version, state, time: now(),
    });
  };
  const tick = async () => {
    if (busy || stopped || !child.call || child.reused) return;
    busy = true;
    try {
      const file = join(root, "launch.luon");
      const info = await stat(file).catch(() => undefined);
      const next = info ? `${info.mtimeMs}:${info.size}` : "";
      if (next && next !== stamp) {
        const candidate = await readLuon(Bun.file(file));
        stamp = next;
        pending = candidate.manifest.id === pkg.id
          && candidate.manifest.version !== pkg.version
          ? candidate.manifest : undefined;
      }
      if (!pending) return;
      const config = await readAuto(stateRoot);
      const policy = resolvePolicy(pkg.update, config.restart ?? {},
        config.overrides?.[pkg.id]);
      if (!config.active || !config.apps || pkg.autoPatch === false
        || policy.apply !== "restart") { await status("next-launch"); return; }
      const slot = restartSlot(new Date(now()), policy, await deviceSeed(stateRoot), pkg.id);
      if (!slot || now() < slot.due) { await status("scheduled"); return; }
      if (now() < retry) return;
      const cancel = await prepareRestart(child.call,
        pkg.app?.window?.browserControl === true);
      if (!cancel) {
        retry = now() + 5000 + Math.random() * 25_000;
        await status("locked-or-unavailable");
        return;
      }
      try {
        const fresh = await readAuto(stateRoot);
        const current = resolvePolicy(pkg.update, fresh.restart ?? {},
          fresh.overrides?.[pkg.id]);
        const allowed = restartSlot(new Date(now()), current,
          await deviceSeed(stateRoot), pkg.id);
        if (stopped || !fresh.active || !fresh.apps
          || current.apply !== "restart" || !allowed
          || now() < allowed.due) { await cancel(); return; }
        await status("restarting");
        (options.close ?? controlView)(child.pid, "close");
        requested();
        stopped = true;
      } catch (error) { await cancel(); throw error; }
    } catch (error) {
      console.error("App restart:", String(error));
    } finally { busy = false; }
  };
  const timer = setInterval(() => { void tick(); }, 5000);
  timer.unref();
  return { check: tick, stop: async () => {
    stopped = true;
    clearInterval(timer);
    while (busy) await Bun.sleep(10);
    const { rm } = await import("node:fs/promises");
    await rm(join(folder, `${process.pid}.json`), { force: true });
  } };
}
