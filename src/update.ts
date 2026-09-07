import { dirname, resolve } from "node:path";

import { type Versions, versionLine } from "./version.ts";

export type PackageMeta = {
  "dist-tags"?: Record<string, string>;
  versions?: Record<string, Record<string, unknown>>;
};

export type ReleaseMeta = {
  agent: PackageMeta;
  cli: PackageMeta;
  runtime: PackageMeta;
  worker: PackageMeta;
};

type UpdateOptions = {
  check: boolean;
  current: Versions;
};

type UpdateDeps = {
  install?: () => Promise<void>;
  installed?: () => Promise<Versions>;
  metadata?: () => Promise<ReleaseMeta>;
};

const name = "@luon/cli";
const registry = "https://pkg.luon.dev";
const semver = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

function latest(meta: PackageMeta, name: string) {
  const value = meta["dist-tags"]?.latest || "";
  if (!semver.test(value) || !meta.versions?.[value]) {
    throw new Error(`Could not determine the latest ${name} version.`);
  }
  return value;
}

export function targetVersions(meta: ReleaseMeta): Versions {
  return {
    agent: latest(meta.agent, "Agent"),
    cli: latest(meta.cli, "CLI"),
    runtime: latest(meta.runtime, "Runtime"),
    worker: latest(meta.worker, "Worker"),
  };
}

export function parseVersions(output: string): Versions {
  try {
    const value = JSON.parse(output) as Partial<Versions>;
    if ([value.agent, value.cli, value.runtime, value.worker]
      .every((item) => typeof item === "string" && semver.test(item))) {
      return value as Versions;
    }
  } catch {
    // Older CLI releases return the human-readable version line.
  }
  const match = output.match(
    /Luon CLI (\S+) · Agent (\S+) · Runtime (\S+) · Worker (\S+)/,
  );
  if (!match) throw new Error("Could not verify the installed Luon versions.");
  return {
    agent: match[2]!,
    cli: match[1]!,
    runtime: match[3]!,
    worker: match[4]!,
  };
}

function same(left: Versions, right: Versions) {
  return left.agent === right.agent
    && left.cli === right.cli
    && left.runtime === right.runtime
    && left.worker === right.worker;
}

async function readMeta(value: string) {
  const response = await fetch(
    `${registry}/${encodeURIComponent(value)}`,
    { signal: AbortSignal.timeout(10_000) },
  );
  if (!response.ok) {
    throw new Error(
      `Could not check ${value} version. (${response.status})`,
    );
  }
  return await response.json() as PackageMeta;
}

async function metadata() {
  const [agent, cli, runtime, worker] = await Promise.all([
    readMeta("@luon/agent"),
    readMeta(name),
    readMeta("@luon/runtime"),
    readMeta("@luon/worker"),
  ]);
  return { agent, cli, runtime, worker };
}

export function webviewName(platform: string, arch: string) {
  const os = { darwin: "macos", win32: "windows", linux: "linux" }[
    platform as "darwin" | "win32" | "linux"
  ];
  if (!os || !["x64", "arm64"].includes(arch)
    || (os === "macos" && arch !== "arm64")) return "";
  return `@luon/webview-${os}-${arch === "x64" ? "amd64" : arch}`;
}

export async function installTargets(
  target: Versions,
  read = readMeta,
  platform: string = process.platform,
  arch: string = process.arch,
) {
  const packages: Record<string, string> = Object.fromEntries(
    Object.entries(target).map(([id, version]) => [`@luon/${id}`, version]),
  );
  const native = webviewName(platform, arch);
  const names = ["@luon/webview", ...(native ? [native] : [])];
  await Promise.all(names.map(async (id) => {
    packages[id] = latest(await read(id), id);
  }));
  return packages;
}

async function install(target: Versions) {
  const packages = await installTargets(target);
  const child = Bun.spawn([
    process.execPath,
    "update",
    "--global",
    "--force",
    "--no-cache",
    "--registry",
    registry,
    ...Object.entries(packages).map(([id, version]) => `${id}@${version}`),
  ], {
    stderr: "pipe",
    stdin: "ignore",
    stdout: "pipe",
  });
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  if (code !== 0) {
    const detail = stderr.trim() || stdout.trim();
    throw new Error(detail.split("\n").at(-1) || "The Luon CLI update failed.");
  }
  const wrapper = Bun.resolveSync("@luon/webview", import.meta.dir);
  for (const [id, expected] of Object.entries(packages)) {
    if (!id.startsWith("@luon/webview")) continue;
    const entry = id === "@luon/webview"
      ? wrapper : Bun.resolveSync(id, dirname(wrapper));
    const file = resolve(dirname(entry), "../package.json");
    const { version } = await Bun.file(file).json();
    if (version !== expected) {
      throw new Error(`${id}@${version} installed; expected ${expected}.`);
    }
  }
  console.log(Object.entries(packages)
    .filter(([id]) => id.startsWith("@luon/webview"))
    .map(([id, version]) => `${id}@${version}`).join(" · "));
}

function globalBin() {
  const command = process.platform === "win32" ? "luon.exe" : "luon";
  return resolve(dirname(process.execPath), command);
}

async function installed() {
  const child = Bun.spawn([globalBin(), "version", "--json"], {
    stderr: "pipe",
    stdout: "pipe",
  });
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  if (code !== 0) {
    throw new Error(stderr.trim() || "Could not run the updated Luon CLI.");
  }
  return parseVersions(stdout);
}

export async function updateCli(
  options: UpdateOptions,
  deps: UpdateDeps = {},
) {
  const meta = await (deps.metadata || metadata)();
  const target = targetVersions(meta);
  console.log(`${versionLine(options.current)} → ${versionLine(target)}`);
  if (options.check) {
    if (!same(options.current, target)) return;
    console.log("Luon CLI, Agent, Runtime, and Worker are already up to date.");
    return;
  }
  console.log("Installing the latest Luon package set…");
  if (deps.install) await deps.install();
  else await install(target);
  const next = await (deps.installed || installed)();
  if (!same(next, target)) {
    throw new Error(
      `${versionLine(next)} installed; expected ${versionLine(target)}.`,
    );
  }
  console.log(`${versionLine(next)} updated`);
}
