import { type Versions, updateLines } from "./version";
import { mkdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { cachedFeed, engineSet, engineUrl, type EngineFeed } from "./patch-feed";
import { patchLock, patchRoot, readState, writeState } from "./patch-state";

export function globalCli() {
  return join(dirname(process.execPath), process.platform === "win32"
    ? "luon.exe" : "luon");
}
async function packageVersion(name: string, from: string) {
  let entry: string;
  if (name === "@luon/cli") entry = resolve(from, "../package.json");
  else {
    try { entry = Bun.resolveSync(name, from); }
    catch { return undefined; }
  }
  let folder = dirname(entry);
  while (dirname(folder) !== folder) {
    const pkg = await Bun.file(join(folder, "package.json")).json()
      .catch(() => undefined);
    if (pkg?.name === name) return pkg.version as string;
    folder = dirname(folder);
  }
}
export async function engineChanges(packages: Record<string, string>) {
  const changes: string[] = [];
  for (const [name, version] of Object.entries(packages)) {
    const current = await packageVersion(name, import.meta.dir);
    if (!current || Bun.semver.order(version, current) > 0) changes.push(name);
  }
  return changes;
}
async function run(args: string[], cwd?: string) {
  const child = Bun.spawn([process.execPath, ...args], {
    cwd, stdin: "ignore", stdout: "pipe", stderr: "pipe",
  });
  const [code, stdout, stderr] = await Promise.all([child.exited,
    new Response(child.stdout).text(), new Response(child.stderr).text()]);
  if (code) throw new Error(stderr.trim().slice(-1500) || "Update failed.");
  return stdout;
}

export async function installSet(packages: Record<string, string>, options: {
  root?: string; stateRoot?: string; run?: typeof run;
} = {}) {
  const stateRoot = options.stateRoot || patchRoot;
  const execute = options.run || run;
  const unlock = await patchLock("install", stateRoot);
  if (!unlock) throw new Error("Another Luon update is already in progress.");
  let stage = "";
  let root = "";
  let backup = "";
  let moved = false;
  let swapped = false;
  let original = "";
  let oldLock: Uint8Array | undefined;
  try {
    let entry = options.root ? join(options.root, "node_modules")
      : await realpath(import.meta.dir);
    while (dirname(entry) !== entry && basename(entry) !== "node_modules") {
      entry = dirname(entry);
    }
    if (basename(entry) !== "node_modules") {
      throw new Error("Update requires the globally installed Luon CLI.");
    }
    root = dirname(entry);
    oldLock = await Bun.file(join(root, "bun.lock")).bytes()
      .catch(() => undefined);
    original = await readFile(join(root, "package.json"), "utf8");
    const pkg = JSON.parse(original);
    const dependencies = { ...pkg.dependencies };
    for (const name of Object.keys(dependencies)) {
      if (name.startsWith("@luon/")) continue;
      const installed = await Bun.file(join(entry, name, "package.json")).json()
        .catch(() => undefined);
      if (installed?.version) dependencies[name] = installed.version;
    }
    pkg.dependencies = { ...dependencies, ...packages };
    pkg.overrides = { ...pkg.overrides, ...packages };
    stage = join(root, `.luon-next-${crypto.randomUUID()}`);
    backup = join(root, `.luon-previous-${crypto.randomUUID()}`);
    await mkdir(stage, { mode: 0o700 });
    await writeFile(join(stage, "package.json"), JSON.stringify(pkg));
    await execute(["install", "--force", "--no-cache",
      "--production", "--linker", "hoisted",
      "--registry", "https://pkg.luon.dev"], stage);
    for (const [name, version] of Object.entries(packages)) {
      const file = join(stage, "node_modules", name, "package.json");
      const installed = await Bun.file(file).json();
      if (installed.version !== version) throw new Error(`Invalid ${name} version.`);
    }
    const cli = join(stage, "node_modules/@luon/cli/bin/luon.ts");
    JSON.parse(await execute([cli, "version", "--json"]));
    await rename(entry, backup);
    moved = true;
    await rename(join(stage, "node_modules"), entry);
    swapped = true;
    await writeState(join(root, "package.json"), pkg);
    const lock = Bun.file(join(stage, "bun.lock"));
    if (await lock.exists()) {
      await Bun.write(join(root, "bun.lock.next"), lock);
      await rename(join(root, "bun.lock.next"), join(root, "bun.lock"));
    }
    // Keep only the previous successful set for recovery.
    const previous = await readState<{ backup: string }>(
      join(stateRoot, "installed.json"));
    await writeState(join(stateRoot, "installed.json"), {
      packages, backup, installedAt: new Date().toISOString(),
    });
    if (previous?.backup && dirname(previous.backup) === root
      && basename(previous.backup).startsWith(".luon-previous-")) {
      await rm(previous.backup, { recursive: true, force: true }).catch(() => {});
    }
  } catch (error) {
    if (moved) {
      if (swapped) await rename(join(root, "node_modules"), join(stage, "failed"));
      await rename(backup, join(root, "node_modules"));
      if (original) await writeFile(join(root, "package.json"), original);
      if (oldLock) await Bun.write(join(root, "bun.lock"), oldLock);
      else await rm(join(root, "bun.lock"), { force: true });
    }
    throw error;
  } finally {
    if (stage) await rm(stage, { recursive: true, force: true });
    await unlock();
  }
}

export async function updateSet(check: boolean, current: Versions) {
  const feed = await cachedFeed<EngineFeed>(engineUrl, { force: true });
  if (!feed) throw new Error("The Luon release index is unavailable.");
  const packages = engineSet(feed);
  const before: Record<string, string | undefined> = {};
  const after: Record<string, string> = {};
  for (const [name, version] of Object.entries(packages)) {
    const key = name.slice("@luon/".length);
    before[key] = await packageVersion(name, import.meta.dir);
    after[key] = version;
  }
  before.cli = current.cli;
  if (!check) {
    await installSet(packages);
    for (const [name, expected] of Object.entries(packages)) {
      const actual = await packageVersion(name, import.meta.dir);
      if (actual !== expected) {
        throw new Error(`${name}@${actual || "missing"}; expected ${expected}.`);
      }
    }
  }
  console.log(updateLines(before, after).join("\n"));
}
