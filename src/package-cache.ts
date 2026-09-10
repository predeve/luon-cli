import { mkdir, readdir, rename, rm, stat, utimes } from "node:fs/promises";
import { unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { readLuon, type LuonFile } from "@luon/runtime/luon-file";

const programs = new WeakMap<LuonFile, string>();
const leases = new Set<string>();
process.once("exit", () => {
  for (const lease of leases) {
    try { unlinkSync(lease); } catch {}
  }
});
export const cachedProgram = (pkg: LuonFile) => programs.get(pkg);

function pathFor(name: string) {
  if (!name || name.split(/[\\/]/).some((part) => (
    !part || part === "." || part === ".." || part.includes(":")
  ))) throw new Error("Invalid package cache path.");
  if (name.startsWith("site/")) return `program/${name.slice(5)}`;
  if (name === "runtime/server.js") return "program/server.js";
  return name;
}

async function prune(root: string, keep: string) {
  const entries = await readdir(root, { withFileTypes: true });
  const rows = await Promise.all(entries.filter((entry) => (
    entry.isDirectory() && /^[a-f0-9]{64}$/.test(entry.name)
  )).map(async (entry) => {
    const path = join(root, entry.name);
    const info = await stat(join(path, "index.json")).catch(() => undefined);
    const index = await Bun.file(join(path, "index.json")).json()
      .catch(() => undefined);
    return { path, used: info?.mtimeMs || 0, size: Number(index?.size) || 0 };
  }));
  let size = rows.reduce((sum, row) => sum + row.size, 0);
  for (const row of rows.sort((a, b) => a.used - b.used)) {
    if (row.path === keep) continue;
    if (size <= 1024 ** 3 && Date.now() - row.used < 7 * 86400_000) continue;
    const names = await readdir(row.path).catch(() => []);
    const busy = names.filter((name) => /^lease-\d+$/.test(name)).some((name) => {
      try { process.kill(Number(name.slice(6)), 0); return true; }
      catch (error) { return (error as NodeJS.ErrnoException).code !== "ESRCH"; }
    });
    if (busy) continue;
    await rm(row.path, { recursive: true, force: true });
    size -= row.size;
  }
}

export async function cachedLuon(source: Blob, cacheRoot?: string) {
  const hash = new Bun.CryptoHasher("sha256");
  for await (const chunk of source.stream()) hash.update(chunk);
  const key = hash.digest("hex");
  const root = cacheRoot || join(homedir(), ".luon", "cache", "packages");
  const path = join(root, key);
  const indexFile = join(path, "index.json");
  await mkdir(path, { recursive: true, mode: 0o700 });
  const lease = join(path, `lease-${process.pid}`);
  await Bun.write(lease, "");
  leases.add(lease);
  let index = await Bun.file(indexFile).json().catch(() => undefined);
  if (!index) {
    let pkg = await readLuon(source);
    if (pkg.source) {
      const { buildSource } = await import("./source-build.ts");
      pkg = await buildSource(pkg, path);
    }
    const files: string[] = [];
    let size = 0;
    for (const [name, file] of pkg.files) {
      const target = join(path, pathFor(name));
      await mkdir(dirname(target), { recursive: true, mode: 0o700 });
      const temp = `${target}.${process.pid}.tmp`;
      await Bun.write(temp, file);
      await rename(temp, target);
      files.push(name);
      size += file.size;
    }
    index = { manifest: pkg.manifest, files, size };
    const temp = `${indexFile}.${process.pid}.tmp`;
    await Bun.write(temp, JSON.stringify(index));
    await rename(temp, indexFile);
  }
  const files = new Map<string, File>();
  for (const name of index.files as string[]) {
    const file = Bun.file(join(path, pathFor(name)));
    if (!await file.exists()) throw new Error("Package cache is incomplete.");
    files.set(name, file as unknown as File);
  }
  const pkg: LuonFile = { manifest: index.manifest, files };
  if (pkg.manifest.mode === "fullstack") programs.set(pkg, join(path, "program"));
  const now = new Date();
  await utimes(indexFile, now, now);
  void prune(root, path).catch(() => undefined);
  return pkg;
}
