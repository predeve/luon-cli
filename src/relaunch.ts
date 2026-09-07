import { chmod, copyFile, rename, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function cliCommand(args: string[]) {
  return [process.execPath,
    fileURLToPath(new URL("../bin/luon.ts", import.meta.url)), ...args];
}

export async function keepPackage(source: string, root: string) {
  const target = join(root, "launch.luon");
  if (resolve(source) === resolve(target)) return target;
  const temp = join(root, `.launch-${randomUUID()}.luon`);
  try {
    await copyFile(source, temp);
    await chmod(temp, 0o600);
    await rename(temp, target);
  } finally { await rm(temp, { force: true }); }
  return target;
}
