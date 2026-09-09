import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { packLuon, readLuon, writeLuon }
  from "@luon/runtime/luon-file";
import { cachedFeed, storeUrl, type RequestFn } from "../src/patch-feed";
import { patchApp } from "../src/patch";
import { updateApps } from "../src/update-apps";

let root = "";
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});
async function fixture(autoUpdate = false) {
  root = await mkdtemp(resolve("luon-temp/manual-update-"));
  const dir = join(root, "app", "test");
  await mkdir(dir, { recursive: true });
  const project = join(root, "project");
  await mkdir(join(project, "dist/app"), { recursive: true });
  await Bun.write(join(project, "package.json"), JSON.stringify({
    name: "app-test", title: "Test app",
  }));
  await Bun.write(join(project, "app.config.json"),
    JSON.stringify({ autoUpdate }));
  await Bun.write(join(project, "dist/luon.json"), '{"mode":"static"}');
  await Bun.write(join(project, "dist/app/index.html"), "test");
  const old = await (await packLuon({ root: project, id: "app-test",
    type: "app", name: "app-test", version: "1" })).bytes();
  const { manifest, files } = await readLuon(old);
  const next = await (await writeLuon({
    manifest: { ...manifest, version: "2" }, files,
  })).bytes();
  const hash = (bytes: Uint8Array) => new Bun.CryptoHasher("sha256")
    .update(bytes).digest("hex");
  const feed = { format: 1, apps: { test: {
    hash: hash(next), known: [hash(old)], size: next.length,
    version: "2", url: "/app.luon",
  } } };
  const path = join(dir, "launch.luon");
  await Bun.write(path, old);
  await Bun.write(join(dir, "data.txt"), "keep user data");
  let downloads = 0;
  let checks = 0;
  const request = (async (input: string | URL) => {
    const url = new URL(input);
    if (url.pathname === "/app.luon") {
      downloads++;
      return new Response(next);
    }
    checks++;
    expect(url.searchParams.has("check")).toBe(true);
    return Response.json(feed);
  }) as RequestFn;
  return { path, manifest, request, feed,
    counts: () => ({ downloads, checks }) };
}

test("manual updates bypass opt-out and preserve user data", async () => {
  const f = await fixture();
  let prompts = 0;
  await updateApps(false, { home: root, root: join(root, "updates"),
    request: f.request, offer: async () => { prompts++; return false; } });
  expect((await readLuon(Bun.file(f.path))).manifest.version).toBe("2");
  expect(await Bun.file(join(root, "app/test/data.txt")).text())
    .toBe("keep user data");
  expect(prompts).toBe(0);
  expect(f.counts()).toEqual({ downloads: 1, checks: 1 });
});

test("manual check reports the release without installing or prompting", async () => {
  const f = await fixture();
  await updateApps(true, { home: root, root: join(root, "updates"),
    request: f.request, offer: async () => { throw new Error("Unexpected UI"); } });
  expect((await readLuon(Bun.file(f.path))).manifest.version).toBe("1");
  expect(f.counts()).toEqual({ downloads: 0, checks: 1 });
});

test("app launch finds a new release despite a fresh old index cache", async () => {
  const f = await fixture();
  const state = join(root, "updates");
  await cachedFeed(storeUrl, { root: state,
    request: (async () => Response.json({ format: 1, apps: {} })) as RequestFn });
  let prompts = 0;
  await patchApp(f.path, { ...f.manifest, autoPatch: true }, {
    root: state, request: f.request,
    offer: async () => { prompts++; return false; },
  });
  expect(prompts).toBe(1);
  expect(f.counts()).toEqual({ downloads: 0, checks: 1 });
});

test("forced checks fail instead of reporting stale cache as latest", async () => {
  await fixture();
  await cachedFeed(storeUrl, { root,
    request: (async () => Response.json({ format: 1, apps: {} })) as RequestFn });
  await expect(cachedFeed(storeUrl, { root, force: true,
    request: (async () => { throw new Error("Offline"); }) as RequestFn,
  })).rejects.toThrow("Offline");
});

test("a corrupt download fails without replacing the installed app", async () => {
  const f = await fixture();
  const request = (async (input: string | URL, init?: RequestInit) => {
    if (new URL(input).pathname === "/app.luon") {
      return new Response("corrupt release");
    }
    return f.request(input, init);
  }) as RequestFn;
  await expect(updateApps(false, {
    home: root, root: join(root, "updates"), request,
  })).rejects.toThrow("1 app update(s) failed");
  expect((await readLuon(Bun.file(f.path))).manifest.version).toBe("1");
});


test("scheduled updates respect the app's automatic-update opt-out", async () => {
  const f = await fixture();
  await updateApps(false, { home: root, root: join(root, "updates"),
    automatic: true, request: f.request });
  expect(f.counts()).toEqual({ downloads: 0, checks: 0 });
  expect((await readLuon(Bun.file(f.path))).manifest.version).toBe("1");
});


test("scheduled updates include an app configured with autoUpdate true", async () => {
  const f = await fixture(true);
  await updateApps(false, { home: root, root: join(root, "updates"),
    automatic: true, request: f.request });
  expect(f.counts()).toEqual({ downloads: 1, checks: 1 });
  expect((await readLuon(Bun.file(f.path))).manifest.version).toBe("2");
});

test("app autoUpdate false skips launch checks before reading its file", async () => {
  const f = await fixture(false);
  const path = join(root, "not-read.luon");
  expect(await patchApp(path, f.manifest, { request: f.request })).toBe(path);
  expect(f.counts()).toEqual({ downloads: 0, checks: 0 });
});
