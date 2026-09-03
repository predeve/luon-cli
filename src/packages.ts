import { resolve } from "node:path";

type PackageJson = {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

export function latestPackages(value: PackageJson) {
  const names: string[] = [];
  let changed = false;
  for (const group of [value.dependencies, value.devDependencies]) {
    if (!group) continue;
    for (const [name, version] of Object.entries(group)) {
      if (!name.startsWith("@luon/") || version.startsWith("workspace:")) {
        continue;
      }
      names.push(name);
      if (version === "latest") continue;
      group[name] = "latest";
      changed = true;
    }
  }
  return { changed, names: [...new Set(names)].toSorted(), value };
}

export async function updatePackages(input = ".") {
  const root = resolve(input);
  const file = Bun.file(resolve(root, "package.json"));
  if (!await file.exists()) return false;
  const result = latestPackages(await file.json() as PackageJson);
  if (!result.names.length) return false;
  if (result.changed) {
    await Bun.write(file, `${JSON.stringify(result.value, null, 2)}\n`);
  }
  const child = Bun.spawn([
    process.execPath,
    "update",
    "--latest",
    "--registry",
    "https://pkg.luon.dev",
    ...result.names,
  ], {
    cwd: root,
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
      (stderr || stdout || "Could not update Luon packages.").trim(),
    );
  }
  const current = latestPackages(await file.json() as PackageJson);
  if (current.changed) {
    await Bun.write(file, `${JSON.stringify(current.value, null, 2)}\n`);
  }
  return true;
}
