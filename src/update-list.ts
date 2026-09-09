import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { readLuon } from "@luon/runtime/luon-file";
import { patchRoot, readState } from "./patch-state";
export type UpdateApp = { id: string; title: string; state: string };
export async function updateList(): Promise<UpdateApp[]> {
  const states = new Map<string, string>();
  const folder = join(patchRoot, "running");
  for (const name of await readdir(folder).catch(() => [] as string[])) {
    const value = await readState<{ id: string; pid: number; state: string;
      time: number }>(join(folder, name));
    if (!value || Date.now() - value.time > 60_000) continue;
    try { process.kill(value.pid, 0); states.set(value.id, value.state); }
    catch {}
  }
  const apps = new Map<string, UpdateApp>();
  for (const kind of ["app", "web"]) {
    const root = join(homedir(), ".luon", kind);
    for (const name of await readdir(root).catch(() => [] as string[])) {
      try {
        const { manifest: m } = await readLuon(Bun.file(
          join(root, name, "launch.luon")));
        apps.set(m.id, { id: m.id, title: m.title,
          state: states.get(m.id) ?? "No pending restart" });
      } catch {}
    }
  }
  return [...apps.values()].sort((a, b) => a.title.localeCompare(b.title));
}
