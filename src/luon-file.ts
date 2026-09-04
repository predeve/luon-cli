import {
  lstat,
  mkdir,
  readlink,
  symlink,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
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
import { controlViewId, openView } from "@luon/webview";
import {
  startWorker,
  type LocalWorker,
} from "@luon/worker/local";

import type { Args } from "./args.ts";
import {
  dockIcon,
  iconSource,
  systemIcon,
  viewOptions,
} from "./app.ts";
import { buildIcon } from "./icon.ts";
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

function siteFiles(pkg: LuonFile) {
  const files = new Map<string, Blob>();
  for (const [name, file] of pkg.files) {
    if (!name.startsWith("site/")) continue;
    const path = `/${name.slice("site/".length)}`;
    files.set(path, new Blob([file], { type: contentType(path) }));
  }
  return files;
}

function staticServer(files: Map<string, Blob>, port: number) {
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

function prismaState(name: string) {
  if (process.platform === "darwin") {
    return join(
      homedir(),
      "Library",
      "Application Support",
      "prisma-dev-nodejs",
      name,
    );
  }
  if (process.platform === "win32") {
    const local = process.env.LOCALAPPDATA
      || join(homedir(), "AppData", "Local");
    return join(local, "prisma-dev-nodejs", "Data", name);
  }
  const local = process.env.XDG_DATA_HOME
    || join(homedir(), ".local", "share");
  return join(local, "prisma-dev-nodejs", name);
}

async function linkDatabase(name: string, target: string) {
  const link = prismaState(name);
  await mkdir(target, { mode: 0o700, recursive: true });
  await mkdir(dirname(link), { mode: 0o700, recursive: true });
  const info = await lstat(link).catch(() => undefined);
  if (info?.isSymbolicLink()) {
    const current = resolve(dirname(link), await readlink(link));
    if (current === resolve(target)) return;
  }
  if (info) {
    throw new Error(`The local database path is already in use: ${link}`);
  }
  await symlink(target, link, process.platform === "win32" ? "junction" : "dir");
}

async function run(args: string[], root: string, env = process.env) {
  const child = Bun.spawn(args, {
    cwd: root,
    env,
    stderr: "pipe",
    stdout: "pipe",
  });
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  if (code !== 0) {
    throw new Error(
      [stderr, stdout].map((value) => value.trim()).filter(Boolean).join("\n")
        || "The local database update failed.",
    );
  }
}

function dbConfig() {
  const engine = import.meta.resolve("@prisma/cli-engine");
  const orm = import.meta.resolve("@prisma/orm-postgres/config");
  return [
    `import { definePrismaConfig } from ${JSON.stringify(engine)};`,
    `import { defineConfig } from ${JSON.stringify(orm)};`,
    "",
    "export default definePrismaConfig({",
    "  orm: defineConfig({",
    '    contract: new URL("./contract.ts", import.meta.url).pathname,',
    "    db: { connection: process.env.DATABASE_URL! },",
    "  }),",
    "});",
    "",
  ].join("\n");
}

type DbMarker = {
  initial?: Array<{
    file: string;
    models: string[];
    source?: string;
  }>;
  models?: Record<string, unknown>;
};

function initialSource(root: string, marker: DbMarker) {
  const initial = (marker.initial || []).filter((item) => item.source);
  const orm = import.meta.resolve("@prisma/orm-postgres/runtime");
  const seed = import.meta.resolve("@luon/runtime/seed");
  return [
    `import postgres from ${JSON.stringify(orm)};`,
    `import { applySeeds, readSeeds, resetSeedSequences } from ${JSON.stringify(
      seed,
    )};`,
    `import contractJson from ${JSON.stringify(
      pathToFileURL(join(root, "contract.json")).href,
    )} with { type: "json" };`,
    "",
    ...initial.map((item, index) => (
      `const initial${index} = ${item.source};`
    )),
    "",
    `const models = ${JSON.stringify(marker.models || {})};`,
    "const specs = [",
    ...initial.map((item, index) => [
      "  {",
      `    file: ${JSON.stringify(item.file)},`,
      `    models: ${JSON.stringify(item.models)},`,
      `    run: initial${index},`,
      "  },",
    ].join("\n")),
    "];",
    "const url = process.env.DATABASE_URL!;",
    "const client = postgres({ contractJson, url });",
    "try {",
    "  const values = await readSeeds(specs, models);",
    "  await applySeeds(client.orm.public, values.values, models);",
    "  await resetSeedSequences(url, models);",
    "} finally {",
    "  await client.close();",
    "}",
    "",
  ].join("\n");
}

async function writeDbFiles(pkg: LuonFile, root: string) {
  const files = ["contract.json", "contract.d.ts", "source.js", "db.json"];
  for (const name of files) {
    const source = pkg.files.get(`database/${name}`);
    if (source) {
      await writeFile(
        join(root, name),
        new Uint8Array(await source.arrayBuffer()),
      );
    }
  }
  const source = pkg.files.get("database/contract.ts");
  if (!source) throw new Error("The .luon database contract is incomplete.");
  const contract = (await source.text()).replace(
    /^import \{ defineContract \} from [^;]+;/m,
    `import { defineContract } from ${JSON.stringify(
      import.meta.resolve("@prisma/orm-postgres/contract-builder"),
    )};`,
  );
  await writeFile(join(root, "contract.ts"), contract);
  await writeFile(join(root, "prisma.config.ts"), dbConfig());
}

async function startDatabase(pkg: LuonFile, root: string) {
  if (!pkg.manifest.database) return;
  const data = join(root, "data");
  const schema = join(data, "schema");
  const name = `luon-${pkg.manifest.type}-${pkg.manifest.id.slice(
    pkg.manifest.type.length + 1,
  )}`;
  await linkDatabase(name, join(data, "database"));
  await mkdir(schema, { mode: 0o700, recursive: true });
  await writeDbFiles(pkg, schema);
  const { startPrismaDevServer } = await import("@prisma/dev");
  const server = await startPrismaDevServer({
    name,
    persistenceMode: "stateful",
  });
  try {
    const url = server.database.connectionString;
    const markerFile = join(data, "package.json");
    const marker = await Bun.file(markerFile).json().catch(() => undefined) as
      | { version?: string; seeded?: boolean }
      | undefined;
    if (marker?.version !== pkg.manifest.version) {
      await run([
        process.execPath,
        "x",
        "prisma@8.0.0-rc.12",
        "db",
        "update",
        "--config",
        join(schema, "prisma.config.ts"),
        "--db",
        url,
        "--no-interactive",
      ], schema, {
        ...process.env,
        DATABASE_URL: url,
        PRISMA_SKILLS_CHECK: "0",
      });
    }
    let seeded = marker?.seeded === true;
    if (!seeded) {
      const dbMarker = await Bun.file(join(schema, "db.json"))
        .json().catch(() => undefined) as DbMarker | undefined;
      if (dbMarker?.initial?.some((item) => item.source)) {
        const initial = join(schema, "initial.ts");
        await writeFile(initial, initialSource(schema, dbMarker));
        await run([process.execPath, initial], schema, {
          ...process.env,
          DATABASE_URL: url,
        });
      }
      seeded = true;
    }
    await writeFile(markerFile, `${JSON.stringify({
      seeded,
      version: pkg.manifest.version,
    }, null, 2)}\n`);
    return { close: () => server.close(), url } satisfies LocalDb;
  } catch (error) {
    await server.close();
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

async function fullstackServer(
  pkg: LuonFile,
  files: Map<string, Blob>,
  root: string,
  port: number,
  databaseUrl?: string,
) {
  const worker = await startWorker({
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
  const source = pkg.files.get("runtime/server.js");
  if (!source) throw new Error("The .luon server entry is missing.");
  const url = `data:text/javascript;base64,${Buffer.from(
    await source.arrayBuffer(),
  ).toString("base64")}`;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
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
    return { server, worker };
  } catch (error) {
    await worker.close();
    throw error;
  } finally {
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

async function packageIcons(pkg: LuonFile, root: string, page: URL) {
  const source = pkg.files.get("site/favicon.svg");
  if (!source) return {};
  const assets = join(root, "assets");
  const svg = join(assets, "favicon.svg");
  await mkdir(assets, { mode: 0o700, recursive: true });
  await writeFile(svg, new Uint8Array(await source.arrayBuffer()));
  const win = pkg.manifest.app?.window || {};
  const statusSource = win.systemIcon
    ? await iconSource(win.systemIcon, page, {})
    : undefined;
  const statusIcon = statusSource
    ? await systemIcon(statusSource, assets)
    : svg;
  const iconRows = await Promise.all(
    Object.entries(pkg.manifest.app?.icons || {}).map(async ([name, spec]) => {
      const source = await iconSource(spec, page, {});
      const [icon, system] = await Promise.all([
        dockIcon(source, pkg.manifest.favicon?.style || {}, assets)
          .then((value) => buildIcon(value, process.platform, assets)),
        systemIcon(source, assets),
      ]);
      return [name, { icon, systemIcon: system }] as const;
    }),
  );
  return {
    icon: await buildIcon(svg, process.platform, assets),
    icons: Object.fromEntries(iconRows),
    statusIcon,
  };
}

async function openWindow(
  pkg: LuonFile,
  root: string,
  url: string,
  update?: CliUpdate,
) {
  const page = new URL(url);
  const icons = await packageIcons(pkg, root, page);
  const child = await openView(viewOptions({
    id: pkg.manifest.id,
    title: pkg.manifest.title,
    url,
    window: pkg.manifest.app?.window || {},
  }, page, icons.icon, icons.statusIcon, icons.icons));
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
  const bytes = await Bun.file(path).bytes();
  const pkg = isPasswordLuon(bytes)
    ? await askPassword(title, (password) => (
      readLuon(bytes, password).catch(() => undefined)
    ), { pin: isPinLuon(bytes) })
    : await readLuon(bytes).catch(async () => {
      await showInvalidPackage(title);
      return undefined;
    });
  if (!pkg) return;
  const update = await cliUpdate();
  if (!await requireCliVersion(pkg.manifest.title, update)) return;
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
  if (pkg.manifest.data === "server") {
    const url = pkg.manifest.url!;
    console.log(`Luon package: ${pkg.manifest.title} · ${url}`);
    if (args.view === "browser") {
      await openBrowser(url);
      await warnCliVersion(update);
      return;
    }
    await openWindow(pkg, root, url, update);
    return;
  }
  const files = siteFiles(pkg);
  const port = await findPort();
  const db = await startDatabase(pkg, root);
  let server: LocalServer | undefined;
  let worker: LocalWorker | undefined;
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
      await openWindow(pkg, root, url, update);
    }
  } finally {
    await Promise.resolve(server?.stop(true)).catch(() => undefined);
    await worker?.close();
    await db?.close();
    delete (globalThis as Record<symbol, unknown>)[packageFiles];
  }
}
