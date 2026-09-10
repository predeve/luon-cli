import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { packLuon, readLuon, type LuonFile } from "@luon/runtime/luon-file";

async function packageDir(name: string, base: string) {
  let path: string;
  try { path = Bun.resolveSync(`${name}/package.json`, base); }
  catch { path = Bun.resolveSync(name, base); }
  let root = dirname(path);
  while (root !== dirname(root)) {
    const pkg = await Bun.file(join(root, "package.json")).json()
      .catch(() => undefined);
    if (typeof pkg?.name === "string") return { root, pkg };
    root = dirname(root);
  }
  throw new Error(`Cannot locate package: ${name}`);
}

async function modules(root: string, source: Map<string, File>) {
  const target = join(root, "node_modules");
  const seen = new Set<string>();
  async function link(name: string, base: string) {
    if (seen.has(name)) return;
    const value = await packageDir(name, base);
    seen.add(name);
    const path = join(target, name);
    await mkdir(dirname(path), { recursive: true });
    await symlink(value.root, path, "junction");
    for (const dep of Object.keys(value.pkg.dependencies || {})) {
      await link(dep, value.root);
    }
  }
  await link("@luon/runtime", import.meta.dir);
  const pkg = await source.get("package.json")!.json();
  const dependencies: Record<string, string> = {};
  for (const [name, version] of Object.entries({
    ...pkg.dependencies, ...pkg.devDependencies,
  })) {
    if (seen.has(name)) continue;
    if (!/^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/.test(name)
      || typeof version !== "string"
      || /^(?:workspace|file|link):|^[./\\]/.test(version)) {
      throw new Error(`Unsupported source dependency: ${name}`);
    }
    dependencies[name] = version;
  }
  if (!Object.keys(dependencies).length) return;
  const deps = join(root, ".deps");
  await Bun.write(join(deps, "package.json"), JSON.stringify({
    private: true, dependencies,
  }));
  const child = Bun.spawn([process.execPath, "install", "--ignore-scripts"], {
    cwd: deps, stdin: "ignore", stdout: "inherit", stderr: "inherit",
  });
  if (await child.exited !== 0) {
    throw new Error("Editable package dependency installation failed.");
  }
  for (const name of Object.keys(dependencies)) await link(name, deps);
}

export async function buildSource(pkg: LuonFile, parent: string) {
  if (!pkg.source) return pkg;
  const root = await mkdtemp(join(parent, "source-"));
  try {
    for (const [name, file] of pkg.source) {
      await Bun.write(join(root, name), file);
    }
    await modules(root, pkg.source);
    // A child keeps project globals, loaded schemas and imports isolated.
    const entry = fileURLToPath(import.meta.resolve("@luon/runtime/build"));
    const script = join(root, ".compile.ts");
    await Bun.write(script, [
      `import { buildProject } from ${JSON.stringify(entry)};`,
      "await buildProject(process.argv[2]);",
    ].join("\n"));
    const child = Bun.spawn([process.execPath, script, root], {
      cwd: root, stdin: "ignore", stdout: "inherit", stderr: "inherit",
    });
    if (await child.exited !== 0) {
      throw new Error("Editable package build failed. Check its source code.");
    }
    const manifest = pkg.manifest;
    const result = await readLuon(await packLuon({
      compiled: true,
      root,
      id: manifest.id,
      name: manifest.name,
      type: manifest.type,
      version: manifest.version,
      url: manifest.url,
      patch: manifest.patch,
    }));
    result.manifest.autoPatch = manifest.autoPatch;
    return result;
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
