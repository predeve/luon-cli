import { lstat, readdir, realpath, stat, mkdir, open } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, sep } from "node:path";
import { readLuon } from "@luon/runtime/luon-file";
import { readState, writeState } from "./patch-state";
import { keepPackage } from "./relaunch";
import { patchApp } from "./patch";

export type LaunchInfo = { registered: string; opened?: string };
export type LaunchApp = {
  id: string; title: string; version: string; path: string;
  registered: string; opened: string; updated: string;
  size: number; icon: string;
};

export async function noteLaunch(root: string) {
  const file = join(root, "launch.json");
  const prior = await readState<LaunchInfo>(file);
  const info = await stat(join(root, "launch.luon"));
  await writeState(file, {
    registered: prior?.registered || info.birthtime.toISOString(),
    opened: new Date().toISOString(),
  });
}

export function localLaunch(request: Request) {
  if (process.env.LUON_EDITOR === "1" || !process.env.LUON_CLI_ENTRY) return false;
  const url = new URL(request.url);
  const origin = request.headers.get("origin");
  return ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
    && (!origin || origin === url.origin)
    && request.headers.get("sec-fetch-site") !== "cross-site";
}

export function launchpad(root = join(homedir(), ".luon"),
  dispatch?: (args: string[]) => Promise<void>) {
  const busy = new Set<string>();
  async function file(id: string) {
    const match = /^(app|web)-([a-z0-9-]{1,64})$/.exec(id);
    if (!match) throw Error("Invalid app identity.");
    const base = await realpath(root);
    const folder = join(root, match[1]!, match[2]!);
    const path = join(folder, "launch.luon");
    if ((await lstat(folder)).isSymbolicLink()
      || (await lstat(path)).isSymbolicLink()) throw Error("App links are unsupported.");
    const resolved = await realpath(path);
    if (!resolved.startsWith(base + sep)) throw Error("App is outside Luon storage.");
    return resolved;
  }
  async function read(id: string) {
    const path = await file(id);
    const pkg = await readLuon(Bun.file(path));
    if (pkg.manifest.id !== id) throw Error("App identity does not match storage.");
    return { path, pkg };
  }
  async function list() {
    const apps: LaunchApp[] = [];
    let unreadable = 0;
    for (const kind of ["app", "web"]) {
      const rows = await readdir(join(root, kind), { withFileTypes: true })
        .catch(error => {
          if (error.code === "ENOENT") return [];
          throw error;
        });
      for (const row of rows) {
        if (!row.isDirectory() || !/^[a-z0-9-]{1,64}$/.test(row.name)) continue;
        if (!await Bun.file(join(root, kind, row.name, "launch.luon")).exists()) {
          continue;
        }
        try {
          const id = `${kind}-${row.name}`;
          const { path, pkg } = await read(id);
          const info = await stat(path);
          const saved = await readState<LaunchInfo>(join(dirname(path), "launch.json"));
          const image = pkg.files.get("site/favicon.svg");
          const icon = image && image.size <= 64_000
            ? `data:image/svg+xml;base64,${Buffer.from(await image.bytes())
              .toString("base64")}` : "";
          apps.push({ id, title: pkg.manifest.title, version: pkg.manifest.version,
            path, size: info.size, icon, updated: info.mtime.toISOString(),
            registered: saved?.registered || info.birthtime.toISOString(),
            opened: saved?.opened || "" });
        } catch { unreadable++; }
      }
    }
    return { root, apps: apps.sort((a, b) => a.title.localeCompare(b.title)),
      unreadable };
  }
  async function spawn(args: string[]) {
    if (dispatch) return dispatch(args);
    const dir = join(root, "logs", "launchpad");
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const out = await open(join(dir, "launch.log"), "a", 0o600);
    const err = await open(join(dir, "error.log"), "a", 0o600);
    try {
      const child = Bun.spawn(args, {
        stdin: "ignore", stdout: out.fd, stderr: err.fd,
      });
      child.unref();
    } finally {
      await out.close();
      await err.close();
    }
  }
  async function action(id: string, action: string) {
    if (busy.has(id)) throw Error("This app already has an action in progress.");
    busy.add(id);
    try {
      const { path, pkg } = await read(id);
      if (action === "open") {
        const entry = process.env.LUON_CLI_ENTRY;
        if (!entry || !await Bun.file(entry).exists()) {
          throw Error("Update Luon CLI and reopen Launchpad.");
        }
        await spawn([process.execPath, entry, "file", path, "--webview"]);
      } else if (action === "reveal") {
        await spawn(process.platform === "darwin" ? ["open", "-R", path]
          : process.platform === "win32" ? ["explorer.exe", `/select,${path}`]
          : ["xdg-open", dirname(path)]);
      } else if (action === "update") {
        const next = await patchApp(path, pkg.manifest, { manual: true });
        if (next === path) return { message: "No newer update is available." };
        await keepPackage(next, dirname(path));
        return { message: "Updated. Reopen the app to use the new version." };
      } else throw Error("Unknown app action.");
      return { message: action === "open" ? "App launch requested." : "Folder opened." };
    } finally { busy.delete(id); }
  }
  return { list, action };
}
