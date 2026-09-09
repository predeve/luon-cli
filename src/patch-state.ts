import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export const patchRoot = join(homedir(), ".luon", "updates");
export async function readState<T>(file: string): Promise<T | undefined> {
  try { return JSON.parse(await readFile(file, "utf8")); }
  catch { return undefined; }
}
export async function noticeHidden(file: string, now = Date.now()) {
  const state = await readState<{ until: number; snooze?: boolean }>(file);
  if (!state || !Number.isFinite(state.until) || state.until <= now) return false;
  if (state.snooze !== undefined) return state.snooze === true;
  // Older notices stored only expiry: keep explicit 24h snoozes, not 1h Later.
  const info = await stat(file).catch(() => undefined);
  return Boolean(info && state.until - info.mtimeMs > 23 * 60 * 60 * 1000);
}
export async function writeState(file: string, value: unknown) {
  const temp = `${file}.${crypto.randomUUID()}.next`;
  try {
    await writeFile(temp, JSON.stringify(value), { mode: 0o600 });
    await rename(temp, file);
  } finally { await rm(temp, { force: true }); }
}
export async function patchLock(name: string, root = patchRoot) {
  await mkdir(root, { recursive: true, mode: 0o700 });
  const file = join(root, `${name}.lock`);
  const token = crypto.randomUUID();
  for (let retry = 0; retry < 2; retry++) {
    try {
      await writeFile(file, JSON.stringify({ pid: process.pid, token }), {
        flag: "wx", mode: 0o600,
      });
      return async () => {
        if ((await readState<{ token: string }>(file))?.token === token) {
          await rm(file, { force: true });
        }
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const owner = await readState<{ pid: number }>(file);
      if (owner?.pid) {
        try { process.kill(owner.pid, 0); return; }
        catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ESRCH") return;
        }
      } else if (Date.now() - (await stat(file).catch(() => ({ mtimeMs: 0 })))
        .mtimeMs < 60_000) return;
      await rm(file, { force: true });
    }
  }
}
