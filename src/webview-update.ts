import {
  chmod, copyFile, lstat, readdir, rename, rm,
} from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export async function refreshApps(
  bin: string,
  root = join(homedir(), ".luon", "webview", "apps"),
) {
  const folders = await readdir(root, { withFileTypes: true })
    .catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return [];
      throw error;
    });
  let count = 0;
  for (const folder of folders) {
    if (!folder.isDirectory()) continue;
    const path = join(root, folder.name);
    for (const app of await readdir(path, { withFileTypes: true })) {
      if (!app.isDirectory() || !app.name.endsWith(".app")) continue;
      const file = join(path, app.name, "Contents", "MacOS", "Luon WebView");
      const stat = await lstat(file).catch(() => undefined);
      if (!stat?.isFile()) continue;
      const temp = `${file}.${process.pid}.next`;
      try {
        await copyFile(bin, temp);
        await chmod(temp, 0o755);
        await rename(temp, file);
        count++;
      } finally {
        await rm(temp, { force: true });
      }
    }
  }
  return count;
}
