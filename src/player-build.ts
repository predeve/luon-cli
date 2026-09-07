import type { BunPlugin } from "bun";
import type { LuonManifest } from "@luon/runtime/luon-file";

export function nativeApp(manifest: LuonManifest, target: string) {
  const modes = manifest.app?.standalone as
    Record<string, string> | undefined;
  const enabled = modes?.[target] === "native";
  if (enabled && manifest.data === "local") {
    if (manifest.database || manifest.app?.window?.native !== true) {
      throw new Error("Native standalone needs window.native and no local DB.");
    }
    return true;
  }
  return false;
}

export function playerFeatures(manifest: LuonManifest) {
  const input = manifest.features;
  const keys = ["cache", "database", "excel", "pglite", "zip"] as const;
  const known = input && keys.every((key) => typeof input[key] === "boolean");
  return known ? { ...input, database: manifest.database || input.database } : {
    cache: true, database: manifest.database, excel: true, pglite: true, zip: true,
  };
}

export function playerPlugin(manifest: LuonManifest): BunPlugin {
  const features = playerFeatures(manifest);
  const pglite = features.database || features.cache || features.pglite;
  return {
    name: "luon-player-features",
    setup(build) {
      build.onLoad({
        filter: /[/\\]worker[/\\]src[/\\](db|pglite|excel|zip)\.ts$/,
      }, ({ path }) => {
        const name = path.split(/[/\\]/).at(-1)!.slice(0, -3);
        if (name === "db" && features.database) return;
        if (name === "pglite" && pglite) return;
        if (name === "excel" && features.excel) return;
        if (name === "zip" && features.zip) return;
        const fail = "()=>{throw new Error('This app does not use this engine.')}";
        const contents = name === "db" || name === "pglite"
          ? `export const ${name === "db" ? "createDbPool" : "createPglitePool"}
            =()=>({status:()=>[],close:async()=>{},closeAll:async()=>{},
              query:${fail},transaction:${fail},begin:${fail},size:${fail},
              commit:${fail},rollback:${fail}});`
          : name === "excel"
            ? `export const excelOpen=${fail},excelWrite=${fail};`
            : `export const zipPack=${fail},zipUnpack=${fail};`;
        return { contents, loader: "js" };
      });
    },
  };
}
