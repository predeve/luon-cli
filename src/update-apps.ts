import { readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { readLuon } from "@luon/runtime/luon-file";
import { patchApp, type PatchOptions } from "./patch";
import { keepPackage } from "./relaunch";

export async function updateApps(check: boolean, options: PatchOptions & {
  home?: string;
  automatic?: boolean;
} = {}) {
  const home = options.home || join(homedir(), ".luon");
  const feeds: NonNullable<PatchOptions["feeds"]> = new Map();
  let failed = 0;
  for (const kind of ["app", "web"]) {
    const root = join(home, kind);
    const rows = await readdir(root, { withFileTypes: true }).catch((error) => {
      if (error.code === "ENOENT") return [];
      throw error;
    });
    for (const row of rows) {
      if (!row.isDirectory()) continue;
      const dir = join(root, row.name);
      const path = join(dir, "launch.luon");
      if (!await Bun.file(path).exists()) continue;
      try {
        const pkg = await readLuon(Bun.file(path));
        if (options.automatic && pkg.manifest.autoPatch === false) continue;
        const next = await patchApp(path, pkg.manifest, {
          ...options, manual: true, check, feeds,
        });
        if (!check && next !== path) {
          await keepPackage(next, dir);
          const installed = await readLuon(Bun.file(path));
          console.log(`${pkg.manifest.title}: ${pkg.manifest.version}`
            + ` → ${installed.manifest.version}`);
        }
      } catch (error) {
        failed++;
        console.error(`${kind}/${row.name}: ${String(error)}`);
      }
    }
  }
  if (failed) throw new Error(`${failed} app update(s) failed.`);
}
