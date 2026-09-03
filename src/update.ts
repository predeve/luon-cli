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

async function metadata() {
  const read = async (value: string) => {
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
  };
  const [agent, cli, runtime, worker] = await Promise.all([
    read("@luon/agent"),
    read(name),
    read("@luon/runtime"),
    read("@luon/worker"),
  ]);
  return { agent, cli, runtime, worker };
}

async function install() {
  const child = Bun.spawn([
    process.execPath,
    "add",
    "--global",
    "--force",
    "--registry",
    registry,
    `${name}@latest`,
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
}

async function installed() {
  const command = process.platform === "win32" ? "luon.exe" : "luon";
  const bin = resolve(dirname(process.execPath), command);
  const child = Bun.spawn([bin, "version", "--json"], {
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
  await (deps.install || install)();
  const next = await (deps.installed || installed)();
  if (!same(next, target)) {
    throw new Error(
      `${versionLine(next)} installed; expected ${versionLine(target)}.`,
    );
  }
  console.log(`${versionLine(next)} updated`);
}
