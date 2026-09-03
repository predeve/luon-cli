import { realpath, stat } from "node:fs/promises";
import { resolve, sep } from "node:path";

import { findPort, serveLocal } from "@luon/network";
import { syncDb } from "@luon/runtime/db-sync";
import {
  startWorker,
  type LocalWorker,
} from "@luon/worker/local";

import { openLogs, relay } from "./log.ts";
import { manageRun } from "./manage.ts";
import { startLocalDb } from "./local-db.ts";
import { updatePackages } from "./packages.ts";
import { workerSite } from "./site.ts";

type RunOptions = {
  open: boolean;
  port?: number;
  root: string;
};

export { findPort };

async function sitePort(value?: number) {
  if (value !== undefined) return value;
  if (process.env.PORT) {
    const port = Number(process.env.PORT);
    if (!Number.isInteger(port) || port < 1 || port > 65_535) {
      throw new Error("PORT must be an integer between 1 and 65535.");
    }
    return port;
  }
  return findPort();
}

async function background(
  mode: "dev" | "start",
  options: RunOptions,
  root: string,
) {
  if (process.env.LUON_AGENT_CHILD === "1") return false;
  const { runJob } = await import("@luon/agent");
  const port = await sitePort(options.port);
  const meta = await Bun.file(resolve(root, "package.json")).json().catch(
    () => undefined,
  ) as { name?: string } | undefined;
  const entry = Bun.fileURLToPath(new URL("../bin/luon.ts", import.meta.url));
  const command = [process.execPath, entry, mode, root, "--port", String(port)];
  if (options.open) command.push("--open");
  const job = await runJob({
    command,
    mode,
    name: meta?.name,
    port,
    root,
  });
  console.log(
    `Luon ${mode} is managed by Agent at http://localhost:${job.port}`,
  );
  console.log(`Log: ${job.log}`);
  return true;
}

async function openUrl(url: string) {
  const command = process.platform === "darwin"
    ? ["open", url]
    : process.platform === "win32"
      ? ["cmd", "/c", "start", "", url]
      : ["xdg-open", url];
  Bun.spawn(command, { stderr: "ignore", stdout: "ignore" }).unref();
}

async function staticFile(root: string, pathname: string) {
  const folder = await realpath(root).catch(() => "");
  if (!folder) return;
  let value = "";
  try {
    value = decodeURIComponent(pathname);
  } catch {
    return;
  }
  const path = resolve(folder, `.${value}`);
  if (!path.startsWith(`${folder}${sep}`)) return;
  const target = await realpath(path).catch(() => "");
  if (!target.startsWith(`${folder}${sep}`)) return;
  const info = await stat(target).catch(() => undefined);
  return info?.isFile() ? target : undefined;
}

async function runStatic(root: string, port: number, open: boolean) {
  const dist = resolve(root, "dist");
  const app = resolve(dist, "app");
  const index = resolve(app, "index.html");
  if (!await Bun.file(index).exists()) {
    throw new Error("Luon static build was not found. Run luon build first.");
  }
  const server = serveLocal({
    fetch: async (request) => {
      const url = new URL(request.url);
      if (request.method !== "GET" && request.method !== "HEAD") {
        return new Response("Not found", { status: 404 });
      }
      const file = await staticFile(resolve(dist, "public"), url.pathname)
        || await staticFile(app, url.pathname);
      const html = url.pathname === "/"
        || request.headers.get("accept")?.includes("text/html");
      const target = file || (html ? index : "");
      if (!target) return new Response("Not found", { status: 404 });
      return new Response(
        request.method === "HEAD" ? null : Bun.file(target),
      );
    },
    hostname: "localhost",
    port,
  });
  const url = `http://localhost:${server.port}`;
  console.log(`Luon static Site is running at ${url}`);
  if (open) await openUrl(url);
  await new Promise<void>((done) => {
    const close = () => {
      process.off("SIGINT", close);
      process.off("SIGTERM", close);
      void server.stop().finally(done);
    };
    process.on("SIGINT", close);
    process.on("SIGTERM", close);
  });
}

async function waitUrl(url: string, child: Bun.Subprocess) {
  for (let count = 0; count < 80; count += 1) {
    if (child.exitCode !== null) {
      throw new Error("Luon server stopped before becoming ready.");
    }
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // The server is still starting.
    }
    await Bun.sleep(50);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function run(
  command: string[],
  root: string,
  env: Record<string, string>,
  open: boolean,
  port: number,
  worker: LocalWorker,
) {
  const logs = openLogs();
  const child = Bun.spawn(command, {
    cwd: root,
    env: { ...process.env, ...env },
    stderr: logs ? "pipe" : "inherit",
    stdin: "inherit",
    stdout: logs ? "pipe" : "inherit",
  });
  const output = logs
    ? [
      relay(
        child.stdout as ReadableStream<Uint8Array>,
        process.stdout,
        logs.out,
      ),
      relay(
        child.stderr as ReadableStream<Uint8Array>,
        process.stderr,
        logs.error,
      ),
    ]
    : [];
  try {
    await worker.bind(child.pid);
  } catch (error) {
    child.kill("SIGTERM");
    await child.exited;
    await Promise.all(output);
    await worker.close();
    throw error;
  }
  let stopped = false;
  const close = () => {
    if (stopped || child.exitCode !== null) return;
    stopped = true;
    child.kill("SIGTERM");
  };
  process.once("SIGINT", close);
  process.once("SIGTERM", close);
  let managed: Awaited<ReturnType<typeof manageRun>>;
  try {
    managed = await manageRun({
      close,
      file: process.env.LUON_RUN_FILE || "",
      heartbeat: process.env.LUON_CORE_HEARTBEAT || "",
      pipe: process.env.LUON_RUN_PIPE || "",
      port,
      runtime: child.pid,
      site: process.env.LUON_RUN_SITE || "",
      token: process.env.LUON_RUN_TOKEN || "",
      worker,
    });
  } catch (error) {
    close();
    await child.exited;
    await Promise.all(output);
    await worker.close();
    throw error;
  }
  try {
    if (open) {
      const url = `http://localhost:${port}`;
      await waitUrl(url, child);
      await openUrl(url);
    }
    const code = await child.exited;
    await Promise.all(output);
    if (code && !stopped) process.exitCode = code;
  } catch (error) {
    close();
    await child.exited;
    await Promise.all(output);
    throw error;
  } finally {
    process.off("SIGINT", close);
    process.off("SIGTERM", close);
    await managed?.();
    await worker.close();
  }
}

function workerEnv(worker: LocalWorker) {
  return {
    LUON_WORKER_PIPE: worker.pipe,
    LUON_WORKER_SITE: worker.site,
    LUON_WORKER_TOKEN: worker.token,
  };
}

export async function runDev(options: RunOptions) {
  const root = resolve(options.root);
  if (await background("dev", options, root)) return;
  if (process.env.LUON_SKIP_UPDATE !== "1") await updatePackages(root);
  const dir = resolve(root, process.env.LUON_CONFIG || ".config");
  const project = process.env.LUON_PROJECT_READY === "1"
    ? { dir, server: resolve(dir, "server.ts") }
    : await import("@luon/runtime/project").then(({ prepareProject }) => (
      prepareProject(root, {
        base: process.env.LUON_BASE,
        config: process.env.LUON_CONFIG,
        editor: process.env.LUON_EDITOR === "1",
      })
    ));
  const local = await startLocalDb(root);
  const databaseUrl = process.env.DATABASE_URL || local?.url;
  try {
    if (process.env.LUON_DB_READY !== "1") {
      await syncDb(root, databaseUrl);
    }
    const port = await sitePort(options.port);
    const worker = await startWorker(await workerSite(root, databaseUrl));
    await run(
      [
        process.execPath,
        "--hot",
        `--config=${project.dir}/bunfig.toml`,
        project.server,
      ],
      root,
      {
        ...workerEnv(worker),
        LUON_DEV: "1",
        NODE_ENV: "development",
        PORT: String(port),
      },
      options.open,
      port,
      worker,
    );
  } finally {
    await local?.close();
  }
}

export async function runStart(options: RunOptions) {
  const root = resolve(options.root);
  if (await background("start", options, root)) return;
  const manifest = await Bun.file(resolve(root, "dist", "luon.json"))
    .json().catch(() => undefined) as { mode?: string } | undefined;
  if (manifest?.mode === "static") {
    return runStatic(root, await sitePort(options.port), options.open);
  }
  const server = resolve(root, "dist", "server.js");
  if (!await Bun.file(server).exists()) {
    throw new Error("Luon build was not found. Run luon build first.");
  }
  const local = await startLocalDb(root);
  const databaseUrl = process.env.DATABASE_URL || local?.url;
  try {
    await syncDb(root, databaseUrl);
    const port = await sitePort(options.port);
    const worker = await startWorker(await workerSite(root, databaseUrl));
    await run(
      [process.execPath, server],
      resolve(root, "dist"),
      {
        ...workerEnv(worker),
        LUON_DEV: "0",
        NODE_ENV: "production",
        PORT: String(port),
      },
      options.open,
      port,
      worker,
    );
  } finally {
    await local?.close();
  }
}
