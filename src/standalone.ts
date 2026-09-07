import {
  access,
  chmod,
  constants,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { optimizeAsset, staticPayload } from "./static-app.ts";
import { playerFeatures, playerPlugin } from "./player-build.ts";
import { applyEngine, enginePlan } from "./engine.ts";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { readLuon, writeLuon } from "@luon/runtime/luon-file";
import { viewBin } from "@luon/webview";

import type { AppTarget, Args } from "./args.ts";
import { buildIcon } from "./icon.ts";

type TargetSpec = {
  arch: "arm64" | "x64";
  bun: Bun.Build.CompileTarget;
  name: AppTarget;
  native: string;
  platform: "darwin" | "linux" | "win32";
};

const registry = "https://pkg.luon.dev";
const targets: Record<AppTarget, TargetSpec> = {
  "linux-arm64": {
    arch: "arm64",
    bun: "bun-linux-arm64",
    name: "linux-arm64",
    native: "@luon/webview-linux-arm64",
    platform: "linux",
  },
  "linux-x64": {
    arch: "x64",
    bun: "bun-linux-x64",
    name: "linux-x64",
    native: "@luon/webview-linux-amd64",
    platform: "linux",
  },
  "macos-arm64": {
    arch: "arm64",
    bun: "bun-darwin-arm64",
    name: "macos-arm64",
    native: "@luon/webview-macos-arm64",
    platform: "darwin",
  },
  "windows-arm64": {
    arch: "arm64",
    bun: "bun-windows-arm64",
    name: "windows-arm64",
    native: "@luon/webview-windows-arm64",
    platform: "win32",
  },
  "windows-x64": {
    arch: "x64",
    bun: "bun-windows-x64",
    name: "windows-x64",
    native: "@luon/webview-windows-amd64",
    platform: "win32",
  },
};

function hostTarget(): AppTarget | undefined {
  const arch = process.arch === "arm64" ? "arm64"
    : process.arch === "x64" ? "x64" : undefined;
  if (!arch) return;
  if (process.platform === "darwin" && arch === "arm64") {
    return "macos-arm64";
  }
  if (process.platform === "linux") return `linux-${arch}`;
  if (process.platform === "win32") return `windows-${arch}`;
}

export function appTarget(value?: AppTarget) {
  const name = value || hostTarget();
  if (!name || !targets[name]) {
    throw new Error("This operating system cannot build a Luon app.");
  }
  return targets[name];
}

function sameHost(target: TargetSpec) {
  return target.platform === process.platform && target.arch === process.arch;
}

function safeName(value: string) {
  const name = value
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .replace(/[. ]+$/g, "")
    .trim()
    .slice(0, 100);
  return name || "Luon App";
}

function suffix(platform = process.platform) {
  if (platform === "darwin") return ".app";
  if (platform === "win32") return ".exe";
  return "";
}

export function appOutput(
  input: string,
  title: string,
  output?: string,
  platform = process.platform,
) {
  const ext = suffix(platform);
  const target = output
    ? resolve(output)
    : resolve(`${safeName(title || basename(input, extname(input)))}${ext}`);
  if (!ext || target.toLowerCase().endsWith(ext)) return target;
  return `${target}${ext}`;
}

function tarText(bytes: Uint8Array, start: number, length: number) {
  return new TextDecoder().decode(bytes.subarray(start, start + length))
    .replace(/\0.*$/, "")
    .trim();
}

function tarFile(archive: Uint8Array, wanted: string) {
  let offset = 0;
  while (offset + 512 <= archive.byteLength) {
    const name = tarText(archive, offset, 100);
    if (!name) break;
    const prefix = tarText(archive, offset + 345, 155);
    const path = prefix ? `${prefix}/${name}` : name;
    const size = Number.parseInt(tarText(archive, offset + 124, 12), 8);
    if (!Number.isFinite(size) || size < 0) break;
    const start = offset + 512;
    if (path === wanted) return archive.slice(start, start + size);
    offset = start + Math.ceil(size / 512) * 512;
  }
  throw new Error(`The native WebView archive is missing ${wanted}.`);
}

type NativeMeta = {
  "dist-tags"?: { latest?: string };
  versions?: Record<string, {
    dist?: { integrity?: string; tarball?: string };
  }>;
};

function staticVersion(value: unknown, minimum = 8) {
  if (typeof value !== "string") return false;
  const [major = 0, minor = 0, patch = 0] = value.split(".").map(Number);
  return major > 0 || minor > 3 || minor === 3 && patch >= minimum;
}

async function remoteView(target: TargetSpec, root: string, minimum = 0) {
  const response = await fetch(
    `${registry}/${encodeURIComponent(target.native)}`,
    { signal: AbortSignal.timeout(15_000) },
  );
  if (!response.ok) {
    throw new Error(`Could not download ${target.native}. (${response.status})`);
  }
  const meta = await response.json() as NativeMeta;
  const version = meta["dist-tags"]?.latest || "";
  if (minimum && !staticVersion(version, minimum)) {
    throw new Error(`This app needs WebView 0.3.${minimum} or newer.`);
  }
  const release = meta.versions?.[version];
  const tarball = release?.dist?.tarball || "";
  const integrity = release?.dist?.integrity || "";
  const url = URL.parse(tarball);
  if (!url || url.origin !== registry
    || !integrity.startsWith("sha512-")) {
    throw new Error(`The ${target.native} release metadata is invalid.`);
  }
  const archiveResponse = await fetch(url, {
    signal: AbortSignal.timeout(30_000),
  });
  if (!archiveResponse.ok) {
    throw new Error(
      `Could not download ${target.native}. (${archiveResponse.status})`,
    );
  }
  const bytes = new Uint8Array(await archiveResponse.arrayBuffer());
  const hash = createHash("sha512").update(bytes).digest("base64");
  if (`sha512-${hash}` !== integrity) {
    throw new Error(`The ${target.native} release integrity check failed.`);
  }
  const name = target.platform === "win32" ? "webview.exe" : "webview";
  const native = join(root, name);
  const file = tarFile(Bun.gunzipSync(bytes), `package/bin/${name}`);
  await writeFile(native, file, { mode: 0o700 });
  return native;
}

async function targetView(target: TargetSpec, root: string, minimum = 0) {
  if (!sameHost(target)) return remoteView(target, root, minimum);
  const native = viewBin();
  if (minimum) {
    const pkg = await Bun.file(join(dirname(dirname(native)), "package.json"))
      .json().catch(() => undefined);
    if (!staticVersion(pkg?.version, minimum)) {
      return remoteView(target, root, minimum);
    }
  }
  await access(native, constants.X_OK).catch(() => {
    throw new Error(`Luon WebView executable is missing: ${native}`);
  });
  return native;
}

function xml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function plist(title: string, id: string, icon: boolean) {
  const iconKey = icon
    ? "  <key>CFBundleIconFile</key><string>App.icns</string>\n"
    : "";
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleDisplayName</key><string>${xml(title)}</string>
  <key>CFBundleExecutable</key><string>Luon Player</string>
  <key>CFBundleIdentifier</key><string>dev.luon.${xml(id)}</string>
  <key>CFBundleInfoDictionaryVersion</key><string>6.0</string>
  <key>CFBundleName</key><string>${xml(title)}</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>1</string>
  <key>CFBundleVersion</key><string>1</string>
${iconKey}  <key>LSUIElement</key><true/>
  <key>NSAppTransportSecurity</key><dict>
    <key>NSAllowsLocalNetworking</key><true/>
  </dict>
  <key>NSHighResolutionCapable</key><true/>
</dict></plist>
`;
}

function playerSource(
  input: string,
  webview: string,
  fullstack: boolean,
  pglite?: [string, string, string],
  icon?: string,
  icons: Array<[string, string]> = [],
) {
  const file = JSON.stringify(input);
  const view = JSON.stringify(webview);
  const iconImport = icon
    ? `import icon from ${JSON.stringify(icon)} with { type: "file" };`
    : "const icon = \"\";";
  const iconImports = icons.map(([, path], index) => (
    `import stateIcon${index} from ${JSON.stringify(path)} with { type: "file" };`
  )).join("\n");
  const iconSetup = icons.length ? [
    "  process.env.LUON_STANDALONE_ICONS = JSON.stringify({",
    ...icons.map(([spec], index) => (
      `    ${JSON.stringify(spec)}: await asset(stateIcon${index}, `
      + `${JSON.stringify(`state-${index}.svg`)}),`
    )),
    "  });",
  ].join("\n") : "";
  const pgImports = pglite ? [
    `import pgData from ${JSON.stringify(pglite[0])} with { type: "file" };`,
    `import pgInit from ${JSON.stringify(pglite[1])} with { type: "file" };`,
    `import pgWasm from ${JSON.stringify(pglite[2])} with { type: "file" };`,
  ].join("\n") : "";
  const pgSetup = pglite ? [
    '  process.env.LUON_PGLITE_DATA = await asset(pgData, "pglite.data");',
    '  process.env.LUON_PGLITE_INIT = await asset(pgInit, "initdb.wasm");',
    '  process.env.LUON_PGLITE_WASM = await asset(pgWasm, "pglite.wasm");',
  ].join("\n") : "";
  const workerImport = fullstack
    ? `import { runWorker } from ${JSON.stringify(fileURLToPath(
      import.meta.resolve("@luon/worker/runner"),
    ))};`
    : "";
  const workerStart = fullstack ? [
    '  if (process.argv.includes("--luon-worker")) {',
    "    await runWorker();",
    "    return;",
    "  }",
  ].join("\n") : "";
  const runtime = JSON.stringify(fileURLToPath(
    new URL("./player.ts", import.meta.url),
  ));
  return `import app from ${file} with { type: "file" };
import view from ${view} with { type: "file" };
${pgImports}
${iconImport}
${iconImports}
import { appendFile, chmod, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { extname, join } from "node:path";
import { runPlayer } from ${runtime};
${workerImport}

async function asset(source, name) {
  const data = await Bun.file(source).bytes();
  const hash = new Bun.CryptoHasher("sha256").update(data).digest("hex");
  const root = join(homedir(), ".luon", "player", hash);
  const file = join(root, name);
  if (await Bun.file(file).exists()) return file;
  await mkdir(root, { mode: 0o700, recursive: true });
  const temp = join(root, "." + process.pid + "-" + name);
  try {
    await writeFile(temp, data, { mode: 0o700 });
    await chmod(temp, 0o700);
    await rename(temp, file).catch(async (error) => {
      if (!await Bun.file(file).exists()) throw error;
    });
  } finally {
    await rm(temp, { force: true });
  }
  return file;
}

async function main() {
  process.env.LUON_STANDALONE = "1";
  const workerKey = ${JSON.stringify(crypto.randomUUID().replaceAll("-", "").slice(0, 12))};
  process.env.LUON_CONFIG_DIR = join(homedir(), ".luon", "player", workerKey);
  process.env.LUON_LOG_ROOT = join(homedir(), ".luon", "logs");
  process.env.LUON_WORKER_PIPE = process.platform === "win32"
    ? "\\\\\\\\.\\\\pipe\\\\luon-player-" + workerKey
    : join(process.env.LUON_CONFIG_DIR, "worker.sock");
${workerStart}
  const viewName = process.platform === "win32" ? "webview.exe" : "webview";
  process.env.LUON_WEBVIEW_BIN = await asset(view, viewName);
${pgSetup}
  if (icon) {
    const iconName = "icon" + extname(icon);
    process.env.LUON_STANDALONE_ICON = await asset(icon, iconName);
  }
${iconSetup}
  await runPlayer(app);
}

void main().catch(async (error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  const root = join(homedir(), ".luon", "logs", "app");
  await mkdir(root, { recursive: true }).catch(() => undefined);
  await appendFile(
    join(root, "standalone.log"),
    "[" + new Date().toISOString() + "] " + message + "\\n",
  ).catch(() => undefined);
  process.exitCode = 1;
});
`;
}

export function appIcons(pkg: Awaited<ReturnType<typeof readLuon>>) {
  const win = pkg.manifest.app?.window || {};
  const values = [
    win.systemIcon,
    ...Object.values(pkg.manifest.app?.icons || {}),
  ];
  return [...new Set(values.filter((value): value is string => (
    typeof value === "string" && value.startsWith("lucide:")
  )))].map((spec) => {
    const name = spec.slice("lucide:".length);
    if (!/^[a-z0-9-]{1,64}$/.test(name)) {
      throw new Error(`Invalid standalone Lucide icon: ${name}`);
    }
    const path = fileURLToPath(
      import.meta.resolve(`lucide-static/icons/${name}.svg`),
    );
    return [spec, path] as [string, string];
  });
}

async function appIcon(
  pkg: Awaited<ReturnType<typeof readLuon>>,
  root: string,
  platform: NodeJS.Platform,
) {
  const favicon = pkg.files.get("site/favicon.svg");
  if (!favicon) return;
  const source = join(root, "favicon.svg");
  await writeFile(source, new Uint8Array(await favicon.arrayBuffer()));
  return buildIcon(source, platform, root);
}

async function compile(
  entry: string,
  output: string,
  title: string,
  target: TargetSpec,
  icon?: string,
  manifest?: import("@luon/runtime/luon-file").LuonManifest,
) {
  const result = await Bun.build({
    compile: {
      autoloadBunfig: false,
      autoloadDotenv: false,
      outfile: output,
      target: target.bun,
      windows: target.platform === "win32" && sameHost(target) ? {
        description: `${title} · Luon App`,
        hideConsole: true,
        icon,
        publisher: "Luon",
        title,
      } : undefined,
    },
    entrypoints: [entry],
    define: {
      "process.env.LUON_STANDALONE": JSON.stringify("1"),
      "process.env.LUON_PLAYER_DB": JSON.stringify(manifest?.database ? "1" : "0"),
    },
    minify: true,
    plugins: manifest ? [playerPlugin(manifest)] : [],
    target: "bun",
  });
  if (!result.success) {
    const message = result.logs.map((item) => item.message).join("\n");
    throw new Error(message || "Luon standalone build failed.");
  }
}

async function hideConsole(path: string) {
  const bytes = Buffer.from(await Bun.file(path).arrayBuffer());
  if (bytes.toString("ascii", 0, 2) !== "MZ") {
    throw new Error("The Windows executable header is invalid.");
  }
  const header = bytes.readUInt32LE(0x3c);
  if (bytes.toString("ascii", header, header + 4) !== "PE\0\0") {
    throw new Error("The Windows executable header is invalid.");
  }
  bytes.writeUInt16LE(2, header + 24 + 68);
  await writeFile(path, bytes, { mode: 0o700 });
}

async function signApp(path: string) {
  const child = Bun.spawn([
    "codesign",
    "--force",
    "--deep",
    "--sign",
    "-",
    path,
  ], { stderr: "pipe", stdout: "ignore" });
  const [code, error] = await Promise.all([
    child.exited,
    new Response(child.stderr).text(),
  ]);
  if (code !== 0) {
    throw new Error(error.trim() || "macOS app signing failed.");
  }
}

export async function buildStandalone(args: Args) {
  const input = resolve(args.root);
  const target = appTarget(args.target);
  if (extname(input).toLowerCase() !== ".luon"
    || !await Bun.file(input).exists()) {
    throw new Error("Use luon app build <package.luon>.");
  }
  let pkg = await readLuon(await Bun.file(input).bytes()).catch(() => {
    throw new Error(
      "The .luon file must be valid and must not require a sharing PIN.",
    );
  });
  // Only use a locally verified host until other targets publish this capability.
  const host = sameHost(target) ? viewBin() : undefined;
  const metadata = host ? await Bun.file(join(dirname(host),
    "low-compat.json")).json().catch(() => undefined) : undefined;
  const available = metadata?.api === 1 && host && metadata.sha256
    === new Bun.CryptoHasher("sha256").update(await Bun.file(host).bytes())
      .digest("hex");
  let plan = await enginePlan(pkg, target.name, args.preference,
    !!available);
  try { pkg = await applyEngine(pkg, plan); }
  catch (error) {
    plan = { engine: "bun", reason: `Low preparation failed: ${error}` };
  }
  const fullstack = plan.engine === "bun";
  console.log(`Luon engine: ${JSON.stringify(plan)}`);
  const output = appOutput(
    input,
    pkg.manifest.title,
    args.output,
    target.platform,
  );
  if (await lstat(output).then(() => true, () => false)) {
    throw new Error(`The output already exists: ${output}`);
  }
  await mkdir(dirname(output), { recursive: true });
  const temp = await mkdtemp(join(dirname(output), ".luon-app-"));
  try {
    const bridge = pkg.manifest.app?.window?.native === true;
    const native = await targetView(target, temp,
      bridge ? 10 : fullstack ? 0 : 8);
    let pglite: [string, string, string] | undefined;
    const features = playerFeatures(pkg.manifest);
    if (fullstack
      && (features.database || features.cache || features.pglite)) {
      const pgRoot = dirname(fileURLToPath(
        import.meta.resolve("@electric-sql/pglite"),
      ));
      pglite = [
        join(pgRoot, "pglite.data"),
        join(pgRoot, "initdb.wasm"),
        join(pgRoot, "pglite.wasm"),
      ];
    }
    await Promise.all([...(pglite || [])]
      .map((path) => access(path, constants.R_OK)));
    const icon = await appIcon(pkg, temp, target.platform);
    const icons = appIcons(pkg);
    await Promise.all(icons.map(([, path]) => access(path, constants.R_OK)));
    const entry = join(temp, "player.ts");
    let source = input;
    if (fullstack) {
      let changed = false;
      for (const [name, file] of pkg.files) {
        if (!name.startsWith("site/") || !name.endsWith(".png")) continue;
        const next = await optimizeAsset(name, file);
        if (next.length >= file.size) continue;
        pkg.files.set(name, new File([next], name));
        changed = true;
      }
      if (changed) {
        source = join(temp, "app.luon");
        await Bun.write(source, await writeLuon(pkg));
      }
    }
    await writeFile(entry, playerSource(
      source,
      native,
      fullstack,
      pglite,
      icon,
      icons,
    ));
    if (target.platform === "darwin") {
      const bundle = join(temp, `${safeName(pkg.manifest.title)}.app`);
      const contents = join(bundle, "Contents");
      const bin = join(contents, "MacOS", "Luon Player");
      const resources = join(contents, "Resources");
      await mkdir(dirname(bin), { recursive: true });
      await mkdir(resources, { recursive: true });
      if (!fullstack) {
        await copyFile(native, bin);
        await chmod(bin, 0o755);
        await Bun.write(join(resources, "app.luon.bin"),
          await staticPayload(pkg, icon, icons, 0, target.platform, temp));
      } else {
        await compile(entry, bin, pkg.manifest.title, target, icon, pkg.manifest);
      }
      await writeFile(
        join(contents, "Info.plist"),
        plist(pkg.manifest.title, pkg.manifest.id, Boolean(icon)),
      );
      if (icon) await copyFile(icon, join(resources, "App.icns"));
      if (process.platform === "darwin") await signApp(bundle);
      await rename(bundle, output);
    } else {
      const bin = join(temp, basename(output));
      if (!fullstack) {
        const nativeFile = Bun.file(native);
        const data = await staticPayload(
          pkg, icon, icons, nativeFile.size, target.platform, temp,
        );
        await Bun.write(bin, new Blob([await nativeFile.bytes(), data]));
        await chmod(bin, 0o755);
      } else {
        await compile(entry, bin, pkg.manifest.title, target, icon, pkg.manifest);
      }
      if (target.platform === "win32" && !sameHost(target)) {
        await hideConsole(bin);
      }
      await rename(bin, output);
    }
  } finally {
    await rm(temp, { force: true, recursive: true });
  }
  console.log(`Luon app build complete (${target.name}): ${output}`);
  return output;
}
