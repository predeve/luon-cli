import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { findPort } from "@luon/network";
import { openView } from "@luon/webview";
import { packageRoot } from "@luon/runtime/luon-file";
import { cachedLuon } from "./package-cache.ts";
import {
  fullstackServer, packageIcons, siteFiles, startDatabase, staticServer,
} from "./luon-file.ts";
import { viewOptions } from "./app.ts";

export async function runPlayer(path: string) {
  const pkg = await cachedLuon(Bun.file(path));
  const root = packageRoot(pkg.manifest);
  await Promise.all(["assets", "cache", "data", "files"].map((name) => (
    mkdir(join(root, name), { recursive: true, mode: 0o700 })
  )));
  const remote = pkg.manifest.data === "server";
  const db = remote ? undefined : await startDatabase(pkg, root);
  let runtime: Awaited<ReturnType<typeof fullstackServer>> | undefined;
  let server: ReturnType<typeof staticServer> | undefined;
  try {
    if (!remote) {
      const files = siteFiles(pkg);
      const port = await findPort();
      if (pkg.manifest.mode === "static") server = staticServer(files, port);
      else {
        runtime = await fullstackServer(pkg, files, root, port, db?.url);
        server = runtime.server;
      }
    }
    const url = remote ? pkg.manifest.url!
      : `http://localhost:${server!.port}`;
    if (process.argv.includes("--luon-headless")) {
      console.log(url);
      await new Promise<void>((resolve) => {
        process.once("SIGTERM", () => resolve());
        process.once("SIGINT", () => resolve());
      });
    } else {
      const page = new URL(url);
      const icons = await packageIcons(pkg, root, page);
      const child = await openView(viewOptions({
        id: pkg.manifest.id, title: pkg.manifest.title, url,
        window: pkg.manifest.app?.window || {},
      }, page, icons.icon, icons.statusIcon, icons.icons));
      const error = child.stderr
        ? new Response(child.stderr).text() : Promise.resolve("");
      const code = await child.exited;
      if (code) throw new Error((await error).trim() || "App window failed.");
    }
  } finally {
    await Promise.resolve(server?.stop(true));
    await runtime?.worker.close();
    await db?.close();
    if (runtime?.program) await rm(runtime.program, { recursive: true, force: true });
    delete (globalThis as Record<symbol, unknown>)[Symbol.for("@luon/package-files")];
  }
}
