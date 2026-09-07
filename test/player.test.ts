import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { appFeatures } from "../../runtime/src/features.ts";
import { readLuon, writeLuon } from "../../runtime/src/luon-file.ts";
import { cachedLuon } from "../src/package-cache.ts";
import { nativeApp, playerFeatures } from "../src/player-build.ts";
import { serverPage, staticPayload } from "../src/static-app.ts";

let root = "";
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});

async function fixture() {
  const archive = new Bun.Archive({
    "luon.json": JSON.stringify({
      createdAt: new Date().toISOString(), data: "local", database: false,
      format: 1, id: "app-player-test", mode: "static", name: "test",
      runtime: "0.1.73", title: "Test", type: "app", version: "1",
    }),
    "site/index.html": "<h1>Test</h1>",
    "site/first.bin": "identical-resource-for-deduplication",
    "site/second.bin": "identical-resource-for-deduplication",
  }, { compress: "gzip" });
  return readLuon(await archive.bytes());
}

test("detects features conservatively and keeps legacy packages complete", async () => {
  root = await mkdtemp(join(import.meta.dir, "../../../luon-temp/features-"));
  await mkdir(join(root, "server"));
  await Bun.write(join(root, "server/test.ts"), "export const run = () => zip.pack({});");
  expect(await appFeatures(root, false)).toEqual({
    cache: false, database: false, excel: false, pglite: false, zip: true,
  });
  await Bun.write(join(root, "server/test.ts"), "require('custom-engine');");
  expect((await appFeatures(root, false)).excel).toBe(true);
  expect(playerFeatures((await fixture()).manifest).pglite).toBe(true);
});

test("reuses disk-backed package content without rewriting assets", async () => {
  root = await mkdtemp(join(import.meta.dir, "../../../luon-temp/cache-"));
  const pkg = await fixture();
  const source = new Blob([await writeLuon(pkg)]);
  const first = await cachedLuon(source, root);
  const asset = first.files.get("site/index.html")!;
  const before = await stat(asset.name);
  const second = await cachedLuon(source, root);
  expect(await second.files.get("site/index.html")!.text()).toBe("<h1>Test</h1>");
  expect((await stat(asset.name)).mtimeMs).toBe(before.mtimeMs);
});

test("native standalone is explicit and only changes the requested target", async () => {
  const pkg = await fixture();
  pkg.manifest.mode = "fullstack";
  expect(nativeApp(pkg.manifest, "macos-arm64")).toBe(false);
  pkg.manifest.app = { window: { native: true },
    standalone: { "macos-arm64": "native" } };
  expect(nativeApp(pkg.manifest, "macos-arm64")).toBe(true);
  expect(nativeApp(pkg.manifest, "windows-x64")).toBe(false);
  expect(nativeApp(pkg.manifest, "linux-arm64")).toBe(false);
  pkg.manifest.app.standalone!["windows-x64"] = "native";
  pkg.manifest.app.standalone!["linux-arm64"] = "native";
  expect(nativeApp(pkg.manifest, "windows-x64")).toBe(true);
  expect(nativeApp(pkg.manifest, "linux-arm64")).toBe(true);
  pkg.manifest.database = true;
  expect(() => nativeApp(pkg.manifest, "macos-arm64")).toThrow("no local DB");
});

test("stores duplicate static resource bytes only once", async () => {
  const pkg = await fixture();
  const bytes = Buffer.from(await (await staticPayload(pkg, undefined, [])).arrayBuffer());
  expect(bytes.subarray(-24, -16).toString()).toBe("LUONAPP1");
  expect(bytes.readBigUInt64LE(bytes.length - 8)).toBe(BigInt(bytes.length - 24));
  const marker = "identical-resource-for-deduplication";
  expect(bytes.indexOf(marker)).toBe(bytes.lastIndexOf(marker));
  expect(bytes.indexOf(marker)).toBeGreaterThan(0);
});

test("opens server packages at their original top-level URL", async () => {
  const pkg = await fixture();
  const url = "https://chat.example.test/room?name=one&next=</script>";
  pkg.manifest.data = "server";
  pkg.manifest.url = url;
  pkg.files.set("site/index.html", new File([""], "index.html"));
  const page = serverPage(url);
  expect(page.match(/<\/script>/g)).toHaveLength(1);
  let opened = "";
  const script = page.match(/<script>([\s\S]*?)<\/script>/)![1]!;
  new Function("window", script)({
    location: { replace: (value: string) => { opened = value; } },
  });
  expect(opened).toBe(new URL(url).href);
  const payload = await staticPayload(pkg, undefined, []);
  expect(Buffer.from(await payload.arrayBuffer()).includes(page)).toBe(true);
  expect(pkg.files.get("site/index.html")!.size).toBe(0);
});
