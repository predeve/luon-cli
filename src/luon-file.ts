import {
  mkdtemp,
  mkdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { findPort, serveLocal } from "@luon/network";
import {
  isPasswordLuon,
  isPinLuon,
  packageRoot,
  readLuon,
  type LuonFile,
} from "@luon/runtime/luon-file";
import type { IconSource } from "@luon/runtime/favicon";
import type { DbModels } from "@luon/runtime/prisma";
import {
  applySeeds,
  readSeeds,
  resetSeedSequences,
} from "@luon/runtime/seed";
import { controlViewId, openView } from "@luon/webview";
import { cliCommand, keepPackage } from "./relaunch.ts";
import {
  startWorker,
  type LocalWorker,
} from "@luon/worker/local";

import type { Args } from "./args.ts";
import { cachedLuon, cachedProgram } from "./package-cache.ts";
import {
  dockIcon,
  iconSource,
  systemIcon,
  viewOptions,
} from "./app.ts";
import { askPassword } from "./notice.ts";
import {
  cliUpdate,
  requireCliVersion,
  requireServer,
  showInvalidPackage,
  warnCliVersion,
  type CliUpdate,
} from "./launch-check.ts";

type LocalDb = {
  close(): Promise<void>;
  url: string;
};

type LocalServer = {
  port?: number;
  stop(close?: boolean): Promise<void> | void;
};

const packageFiles = Symbol.for("@luon/package-files");

async function buildIcon(
  source: string | undefined,
  platform = process.platform,
  root?: string,
) {
  const icon = await import("./icon.ts");
  return icon.buildIcon(source, platform, root);
}

function filePath(value: string) {
  const path = value.startsWith("file:")
    ? fileURLToPath(value)
    : resolve(value);
  if (extname(path).toLowerCase() !== ".luon") {
    throw new Error("A Luon package must use the .luon extension.");
  }
  return path;
}

function contentType(path: string) {
  const values: Record<string, string> = {
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".ico": "image/x-icon",
    ".jpeg": "image/jpeg",
    ".jpg": "image/jpeg",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".webp": "image/webp",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
  };
  return values[extname(path).toLowerCase()] || "application/octet-stream";
}

export function siteFiles(pkg: LuonFile) {
  const files = new Map<string, Blob>();
  for (const [name, file] of pkg.files) {
    if (!name.startsWith("site/")) continue;
    const path = `/${name.slice("site/".length)}`;
    files.set(path, file.slice(0, file.size, contentType(path)));
  }
  return files;
}

export function staticServer(files: Map<string, Blob>, port: number) {
  return serveLocal({
    fetch(request) {
      const url = new URL(request.url);
      if (request.method !== "GET" && request.method !== "HEAD") {
        return new Response("Not found", { status: 404 });
      }
      const file = files.get(url.pathname);
      const html = url.pathname === "/"
        || request.headers.get("accept")?.includes("text/html");
      const body = file || (html ? files.get("/index.html") : undefined);
      if (!body) return new Response("Not found", { status: 404 });
      return new Response(request.method === "HEAD" ? null : body, {
        headers: { "content-type": body.type },
      });
    },
    hostname: "localhost",
    port,
  });
}

type DbMarker = {
  initial?: Array<{
    file: string;
    models: string[];
    source?: string;
  }>;
  models?: DbModels;
};

async function writeDbFiles(pkg: LuonFile, root: string) {
  const files = ["contract.json", "source.js", "db.json"];
  for (const name of files) {
    const source = pkg.files.get(`database/${name}`);
    if (source) {
      await writeFile(
        join(root, name),
        new Uint8Array(await source.arrayBuffer()),
      );
    }
  }
}

async function updateDatabase(root: string, url: string) {
  const [{ defineConfig }, { createControlClient }] = await Promise.all([
    import("@prisma/orm-postgres/config"),
    import("@prisma/orm-toolchain/cli/control-api"),
  ]);
  const file = join(root, "contract.json");
  const contract = await Bun.file(file).json();
  const config = defineConfig({ contract: file, db: { connection: url } });
  const migrations = join(root, "migrations");
  await mkdir(migrations, { mode: 0o700, recursive: true });
  const client = createControlClient({
    adapter: config.adapter,
    connection: url,
    driver: config.driver,
    extensions: config.extensions,
    family: config.family,
    target: config.target,
  });
  try {
    const result = await client.dbUpdate({
      acceptDataLoss: true,
      contract,
      migrationsDir: migrations,
      mode: "apply",
    });
    if (!result.ok) {
      throw new Error(
        result.failure.summary || result.failure.why
          || "The local database update failed.",
      );
    }
  } finally {
    await client.close();
  }
}

async function seedDatabase(root: string, url: string, marker: DbMarker) {
  const initial = (marker.initial || []).filter((item) => item.source);
  if (!initial.length) return;
  const postgres = (await import("@prisma/orm-postgres/runtime")).default;
  const contractJson = await Bun.file(join(root, "contract.json")).json();
  const specs = await Promise.all(initial.map(async (item) => {
    const source = `export default ${item.source};`;
    const module = await import(`data:text/javascript;base64,${Buffer.from(
      source,
    ).toString("base64")}`);
    return { file: item.file, models: item.models, run: module.default };
  }));
  const models = marker.models || {};
  const client = postgres({ contractJson, url });
  try {
    const values = await readSeeds(specs, models);
    const orm = client.orm.public;
    if (!orm) throw new Error("The local database namespace is missing.");
    await applySeeds(orm, values.values, models);
  } finally {
    await client.close();
  }
  await resetSeedSequences(url, models);
}

export async function startDatabase(pkg: LuonFile, root: string) {
  if (process.env.LUON_PLAYER_DB === "0") return;
  if (!pkg.manifest.database) return;
  const data = join(root, "data");
  const schema = join(data, "schema");
  await mkdir(schema, { mode: 0o700, recursive: true });
  await writeDbFiles(pkg, schema);
  const [{ PGlite }, { PGLiteSocketServer }] = await Promise.all([
    import("@electric-sql/pglite"),
    import("@electric-sql/pglite-socket"),
  ]);
  const path = join(data, "database");
  const pgData = process.env.LUON_PGLITE_DATA;
  const pgInit = process.env.LUON_PGLITE_INIT;
  const pgWasm = process.env.LUON_PGLITE_WASM;
  const database = pgData && pgInit && pgWasm
    ? await PGlite.create({
      dataDir: path,
      fsBundle: new Blob([await Bun.file(pgData).bytes()]),
      initdbWasmModule: await WebAssembly.compile(
        await Bun.file(pgInit).arrayBuffer(),
      ),
      pgliteWasmModule: await WebAssembly.compile(
        await Bun.file(pgWasm).arrayBuffer(),
      ),
    })
    : await PGlite.create(path);
  const socket = new PGLiteSocketServer({
    db: database,
    host: "127.0.0.1",
    port: 0,
  });
  await socket.start();
  try {
    const port = socket.getServerConn().split(":").at(-1);
    const url = `postgres://postgres@127.0.0.1:${port}/postgres?sslmode=disable`;
    const markerFile = join(data, "package.json");
    const marker = await Bun.file(markerFile).json().catch(() => undefined) as
      | { version?: string; seeded?: boolean }
      | undefined;
    if (marker?.version !== pkg.manifest.version) {
      await updateDatabase(schema, url).catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`The local database schema update failed: ${message}`);
      });
    }
    let seeded = marker?.seeded === true;
    if (!seeded) {
      const dbMarker = await Bun.file(join(schema, "db.json"))
        .json().catch(() => undefined) as DbMarker | undefined;
      if (dbMarker?.initial?.some((item) => item.source)) {
        await seedDatabase(schema, url, dbMarker).catch((error) => {
          const message = error instanceof Error ? error.message : String(error);
          throw new Error(`The local database seed failed: ${message}`);
        });
      }
      seeded = true;
    }
    await writeFile(markerFile, `${JSON.stringify({
      seeded,
      version: pkg.manifest.version,
    }, null, 2)}\n`);
    return {
      async close() {
        await socket.stop();
        await database.close();
      },
      url,
    } satisfies LocalDb;
  } catch (error) {
    await socket.stop();
    await database.close();
    throw error;
  }
}

function workerEnv(worker: LocalWorker) {
  return {
    LUON_WORKER_PIPE: worker.pipe,
    LUON_WORKER_SITE: worker.site,
    LUON_WORKER_TOKEN: worker.token,
  };
}

export async function fullstackServer(
  pkg: LuonFile,
  files: Map<string, Blob>,
  root: string,
  port: number,
  databaseUrl?: string,
) {
  const source = pkg.files.get("runtime/server.js");
  if (!source) throw new Error("The .luon server entry is missing.");
  const cached = cachedProgram(pkg);
  const program = cached || await mkdtemp(join(root, "cache", "program-"));
  let worker: LocalWorker | undefined;
  try {
    if (!cached) {
      await Bun.write(join(program, "server.js"), source);
      for (const [name, file] of pkg.files) {
        if (!name.startsWith("site/")) continue;
        const target = join(program, name.slice("site/".length));
        await mkdir(dirname(target), { mode: 0o700, recursive: true });
        await Bun.write(target, file);
      }
    }
    worker = await startWorker({
      cache: "local",
      cachePath: join(root, "cache", "cache"),
      contract: pkg.manifest.database
        ? join(root, "data", "schema", "contract.json")
        : undefined,
      databaseUrl,
      id: pkg.manifest.id,
      pglite: join(root, "cache", "pglite"),
      root,
      timezone: process.env.TZ || "UTC",
    });
  } catch (error) {
    await worker?.close();
    if (!cached) await rm(program, { force: true, recursive: true });
    throw error;
  }
  Object.assign(process.env, {
    ...workerEnv(worker),
    DATABASE_URL: databaseUrl || "",
    HOST: "127.0.0.1",
    LUON_DEV: "0",
    LUON_FILES: join(root, "files"),
    NODE_ENV: "production",
    PORT: String(port),
  });
  (globalThis as Record<symbol, unknown>)[packageFiles] = files;
  let accept!: (server: LocalServer) => void;
  const ready = new Promise<LocalServer>((done) => { accept = done; });
  const global = globalThis as typeof globalThis & {
    __luonPackageReady?: (server: LocalServer) => void;
  };
  global.__luonPackageReady = accept;
  const url = pathToFileURL(join(program, "server.js")).href;
  const cwd = process.cwd();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    process.chdir(program);
    const loading = import(url);
    const server = await Promise.race([
      ready,
      loading.then(() => ready),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("The .luon server did not start.")),
          15_000,
        );
      }),
    ]);
    await worker.bind(process.pid);
    return { program: cached ? undefined : program, server, worker };
  } catch (error) {
    await worker.close();
    if (!cached) await rm(program, { force: true, recursive: true });
    throw error;
  } finally {
    process.chdir(cwd);
    clearTimeout(timer);
    delete global.__luonPackageReady;
  }
}

async function openBrowser(url: string) {
  const command = process.platform === "darwin"
    ? ["open", url]
    : process.platform === "win32"
      ? ["cmd", "/c", "start", "", url]
      : ["xdg-open", url];
  Bun.spawn(command, { stderr: "ignore", stdout: "ignore" }).unref();
}

function waitSignal() {
  return new Promise<void>((done) => {
    const close = () => {
      process.off("SIGINT", close);
      process.off("SIGTERM", close);
      done();
    };
    process.on("SIGINT", close);
    process.on("SIGTERM", close);
  });
}

export async function packageIcons(pkg: LuonFile, root: string, page: URL) {
  const fixed = process.env.LUON_STANDALONE_ICON;
  const source = pkg.files.get("site/favicon.svg");
  if (!source) return { icon: fixed };
  const assets = join(root, "assets");
  const svg = join(assets, "favicon.svg");
  await mkdir(assets, { mode: 0o700, recursive: true });
  await writeFile(svg, new Uint8Array(await source.arrayBuffer()));
  const win = pkg.manifest.app?.window || {};
  let iconFiles: Record<string, unknown> = {};
  try {
    iconFiles = JSON.parse(
      process.env.LUON_STANDALONE_ICONS || "{}",
    ) as Record<string, unknown>;
  } catch {}
  const embedded = (value: unknown): IconSource | undefined => {
    if (typeof value !== "string") return;
    const path = iconFiles[value];
    return typeof path === "string"
      ? { kind: "lucide", value: path }
      : undefined;
  };
  const statusSource = win.systemIcon
    ? embedded(win.systemIcon) || await iconSource(win.systemIcon, page, {})
    : undefined;
  const statusIcon = statusSource
    ? await systemIcon(statusSource, assets)
    : svg;
  const iconRows = await Promise.all(
    Object.entries(pkg.manifest.app?.icons || {}).map(async ([name, spec]) => {
      const source = embedded(spec) || await iconSource(spec, page, {});
      const [icon, system] = await Promise.all([
        fixed || dockIcon(source, pkg.manifest.favicon?.style || {}, assets)
          .then((value) => buildIcon(value, process.platform, assets)),
        systemIcon(source, assets),
      ]);
      return [name, { icon, systemIcon: system }] as const;
    }),
  );
  return {
    icon: fixed || await buildIcon(svg, process.platform, assets),
    icons: Object.fromEntries(iconRows),
    statusIcon,
  };
}

async function openWindow(
  pkg: LuonFile,
  root: string,
  url: string,
  update?: CliUpdate,
  relaunch?: string[],
) {
  const page = new URL(url);
  const icons = await packageIcons(pkg, root, page);
  const child = await openView({ ...viewOptions({
    id: pkg.manifest.id,
    title: pkg.manifest.title,
    url,
    window: pkg.manifest.app?.window || {},
  }, page, icons.icon, icons.statusIcon, icons.icons), relaunch });
  console.log(`Luon WebView: running · PID ${child.pid}`);
  void warnCliVersion(update);
  const code = await child.exited;
  if (code !== 0) {
    const error = child.stderr
      ? (await new Response(child.stderr).text()).trim()
      : "";
    throw new Error(error || `Luon WebView exited with code ${code}.`);
  }
}

export async function runLuonFile(args: Args) {
  const path = filePath(args.root);
  if (!await Bun.file(path).exists()) {
    throw new Error(`The .luon file was not found: ${path}`);
  }
  const title = basename(path, extname(path)) || "Luon package";
  const bytes = await Bun.file(path).slice(0, 256).bytes();
  const pkg = isPasswordLuon(bytes)
    ? await askPassword(title, (password) => (
      readLuon(Bun.file(path), password).catch(() => undefined)
    ), { pin: isPinLuon(bytes) })
    : await cachedLuon(Bun.file(path)).catch(async () => {
      await showInvalidPackage(title);
      return undefined;
    });
  if (!pkg) return;
  const standalone = process.env.LUON_STANDALONE === "1";
  const update = standalone ? undefined : await cliUpdate();
  if (!standalone
    && !await requireCliVersion(pkg.manifest.title, update)) return;
  if (pkg.manifest.data === "server" && args.view === "headless") {
    throw new Error(
      "A server-backed .luon package must open in WebView or a browser.",
    );
  }
  if (pkg.manifest.data === "server"
    && !await requireServer(pkg.manifest.title, pkg.manifest.url!)) return;
  if (args.view === "webview"
    && await controlViewId(pkg.manifest.id, "show")) {
    console.log(`Luon package: already running · ${pkg.manifest.id}`);
    await warnCliVersion(update);
    return;
  }
  const root = packageRoot(pkg.manifest);
  await Promise.all(["assets", "cache", "data", "files"].map((name) => (
    mkdir(join(root, name), { mode: 0o700, recursive: true })
  )));
  const relaunch = process.platform === "darwin" && !standalone
    && args.view === "webview"
    ? cliCommand(["file", await keepPackage(path, root), "--webview"])
    : undefined;
  if (pkg.manifest.data === "server") {
    const url = pkg.manifest.url!;
    console.log(`Luon package: ${pkg.manifest.title} · ${url}`);
    if (args.view === "browser") {
      await openBrowser(url);
      await warnCliVersion(update);
      return;
    }
    await openWindow(pkg, root, url, update, relaunch);
    return;
  }
  const files = siteFiles(pkg);
  const port = await findPort();
  const db = await startDatabase(pkg, root);
  let server: LocalServer | undefined;
  let worker: LocalWorker | undefined;
  let program: string | undefined;
  try {
    if (pkg.manifest.mode === "static") {
      server = staticServer(files, port);
    } else {
      const value = await fullstackServer(
        pkg,
        files,
        root,
        port,
        db?.url,
      );
      server = value.server;
      worker = value.worker;
      program = value.program;
    }
    if (!server?.port) throw new Error("The .luon server port is unavailable.");
    const url = `http://localhost:${server.port}`;
    console.log(`Luon package: ${pkg.manifest.title} · ${url}`);
    if (args.view === "browser") {
      await openBrowser(url);
      void warnCliVersion(update);
      await waitSignal();
    } else if (args.view === "headless") {
      await waitSignal();
    } else {
      await openWindow(pkg, root, url, update, relaunch);
    }
  } finally {
    await Promise.resolve(server?.stop(true)).catch(() => undefined);
    await worker?.close();
    await db?.close();
    if (program) await rm(program, { force: true, recursive: true });
    delete (globalThis as Record<symbol, unknown>)[packageFiles];
  }
}
