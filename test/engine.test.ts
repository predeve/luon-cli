import { expect, test } from "bun:test";
import { applyEngine, enginePlan } from "../src/engine.ts";
import { parseArgs } from "../src/args.ts";
import type { LuonFile } from "@luon/runtime/luon-file";
import { writeLuon } from "@luon/runtime/luon-file";
import { mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { buildStandalone } from "../src/standalone.ts";
import { viewBin } from "@luon/webview";

function app() {
  const entry = new File(["console.log('low')"], "entry.js");
  const hash = new Bun.CryptoHasher("sha256").update("console.log('low')")
    .digest("hex");
  return { manifest: { mode: "fullstack", data: "local", database: false,
    low: { version: 1, hash } }, files: new Map([
    ["site/index.html", new File(["<html><head></head></html>"], "index.html")],
    ["low/entry.js", entry],
  ]) } as LuonFile;
}

test("engine preference defaults to optimization and validates CLI input", () => {
  expect(parseArgs(["app", "build", "test.luon"]).preference).toBe("optimize");
  expect(parseArgs(["app", "build", "test.luon", "--preference", "compatible"])
    .preference).toBe("compatible");
  expect(() => parseArgs(["app", "build", "test.luon", "--preference", "fast"]))
    .toThrow();
});

test("optimization falls back safely and compatibility retains Bun", async () => {
  const pkg = app();
  expect((await enginePlan(pkg, "macos-arm64", "compatible", true)).engine)
    .toBe("bun");
  expect((await enginePlan(pkg, "macos-arm64", "optimize", false)).engine)
    .toBe("bun");
  const plan = await enginePlan(pkg, "macos-arm64", "optimize", true);
  expect(plan.engine).toBe("low");
  const result = await applyEngine(pkg, plan);
  expect(await result.files.get("site/index.html")!.text())
    .toContain('<head><script src="/__luon/low-compat.js"></script>');
  expect(result.manifest.app?.window?.native).toBe(true);
  expect(pkg.manifest.app).toBeUndefined();
  pkg.files.set("low/entry.js", new File(["changed"], "entry.js"));
  expect((await enginePlan(pkg, "macos-arm64", "optimize", true)).engine)
    .toBe("bun");
  delete pkg.manifest.low;
  expect((await enginePlan(pkg, "macos-arm64", "optimize", true)).engine)
    .toBe("bun");
  pkg.manifest.mode = "static";
  expect((await enginePlan(pkg, "macos-arm64", "compatible", true)).engine)
    .toBe("native");
});

test.skipIf(process.platform !== "darwin" || process.arch !== "arm64")(
  "verified Low alternative converts into a Bun-free macOS app", async () => {
    const bin = viewBin();
    const marker = Bun.file(join(bin, "../low-compat.json"));
    if (!await marker.exists()) return;
    const root = await mkdtemp(resolve(import.meta.dir, "../../../luon-temp/engine-"));
    try {
      const pkg = app();
      Object.assign(pkg.manifest, { format: 1, createdAt: new Date().toISOString(),
        id: "app-low-check", type: "app", title: "Low Check", name: "low-check",
        runtime: "0.1.74", version: "test" });
      pkg.files.set("runtime/server.js", new File(["// Bun fallback fixture"],
        "server.js"));
      const input = join(root, "test.luon");
      await Bun.write(input, await writeLuon(pkg));
      const output = await buildStandalone({ command: "app", appAction: "build",
        root: input, output: join(root, "Low Check.app"), open: false, yes: false,
        preference: "optimize", target: "macos-arm64" });
      const executable = Bun.file(join(output, "Contents/MacOS/Luon Player"));
      expect(executable.size).toBeLessThan(2 * 1024 * 1024);
      const payload = await Bun.file(join(output,
        "Contents/Resources/app.luon.bin")).bytes();
      expect(new TextDecoder().decode(payload)).toContain("low-compat.js");
    } finally { await rm(root, { recursive: true, force: true }); }
  },
);
