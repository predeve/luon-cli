import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { findPort } from "@luon/network";
import { openView } from "@luon/webview";
import { packageRoot } from "@luon/runtime/luon-file";
import { cachedLuon } from "./package-cache.ts";
import {
  fullstackServer, packageIcons, siteFiles, startDatabase,
} from "./luon-file.ts";
import { viewOptions } from "./app.ts";

export async function runPlayer(path: string) {
  const pkg = await cachedLuon(Bun.file(path));
  const root = packageRoot(pkg.manifest);
  await Promise.all(["assets", "cache", "data", "files"].map((name) => (
    mkdir(join(root, name), { recursive: true, mode: 0o700 })
  )));
  const db = await startDatabase(pkg, root);
  let runtime: Awaited<ReturnType<typeof fullstackServer>> | undefined;
  try {
    runtime = await fullstackServer(
      pkg, siteFiles(pkg), root, await findPort(), db?.url,
    );
    const url = `http://localhost:${runtime.server.port}`;
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
    await Promise.resolve(runtime?.server.stop(true));
    await runtime?.worker.close();
    await db?.close();
    if (runtime?.program) await rm(runtime.program, { recursive: true, force: true });
    delete (globalThis as Record<symbol, unknown>)[Symbol.for("@luon/package-files")];
  }
}
