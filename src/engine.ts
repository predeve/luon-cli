import type { LuonFile } from "@luon/runtime/luon-file";
import { nativeApp } from "./player-build.ts";

export type BuildPreference = "optimize" | "compatible";
export type EnginePlan = {
  engine: "bun" | "low" | "native";
  reason: string;
  replace?: boolean;
};

export async function enginePlan(pkg: LuonFile, target: string,
  preference: BuildPreference = "optimize", available = false): Promise<EnginePlan> {
  const manifest = pkg.manifest;
  if (preference !== "optimize" && preference !== "compatible") {
    throw new Error("Build preference must be optimize or compatible.");
  }
  const bun = (reason: string): EnginePlan => ({ engine: "bun", reason });
  const window = manifest.app?.window;
  if (window?.browserControl === true || window?.mcpActive === true) {
    return bun("Browser scripts and MCP require the Bun app host.");
  }
  if (manifest.data === "server" || manifest.mode === "static") {
    return { engine: "native", reason: "This app does not need local Bun." };
  }
  if (preference === "compatible") return bun("Compatibility first selected.");
  if (nativeApp(manifest, target)) {
    return { engine: "low", reason: "The app declares a native target." };
  }
  if (manifest.database) return bun("Local database requires Bun.");
  const low = manifest.low;
  if (low?.version !== 1) return bun("No verified Low alternative in this file.");
  if (low.reason) return bun(low.reason);
  const file = pkg.files.get("low/entry.js");
  if (!file || !low.hash || new Bun.CryptoHasher("sha256")
    .update(await file.bytes()).digest("hex") !== low.hash) {
    return bun("Low alternative is missing or its checksum differs.");
  }
  if (!available) return bun("This target has no compatible Low host installed.");
  return { engine: "low", replace: true,
    reason: "All local API handlers passed the Low compatibility check." };
}

export async function applyEngine(pkg: LuonFile, plan: EnginePlan) {
  if (!plan.replace) return pkg;
  const html = pkg.files.get("site/index.html");
  if (!html) throw new Error("Low app HTML is missing.");
  const source = await html.text();
  if (!/<head(?:\s[^>]*)?>/i.test(source)) {
    throw new Error("Low app needs an HTML head element.");
  }
  const files = new Map(pkg.files);
  const name = "/__luon/low-compat.js";
  files.set(`site${name}`, pkg.files.get("low/entry.js")!);
  files.set("site/index.html", new File([source.replace(/<head(?:\s[^>]*)?>/i,
    (tag) => `${tag}<script src="${name}"></script>`)], "index.html"));
  return { files, manifest: { ...pkg.manifest, app: {
    ...pkg.manifest.app, window: { ...pkg.manifest.app?.window, native: true },
  } } };
}
