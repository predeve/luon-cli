import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, utimes } from "node:fs/promises";
import { join, resolve } from "node:path";
import { cachedFeed, engineSet, type EngineFeed } from "../src/patch-feed";
import { installSet } from "../src/patch-install";
import { patchPage } from "../src/patch-dialog";
import { patchApp, savedApp } from "../src/patch";
import type { LuonManifest } from "@luon/runtime/luon-file";
import { noticeHidden, readState } from "../src/patch-state";

let root = "";
const url = "https://pkg.test/releases.json";
const value = { format: 1, revision: "test", packages: {} };
async function fixture() {
  root = await mkdtemp(resolve("luon-temp/patch-"));
  return root;
}
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});
test("shares one check across launches for at least thirty minutes", async () => {
  await fixture();
  let count = 0;
  const request = (async () => {
    count++;
    return Response.json(value, { headers: { etag: '"v1"' } });
  }) as unknown as typeof fetch;
  for (const now of [0, 1, 60_000, 29 * 60_000, 30 * 60_000 - 1]) {
    expect(await cachedFeed<typeof value>(url, { root, now, request })).toEqual(value);
  }
  expect(count).toBe(1);
  await cachedFeed<typeof value>(url, { root, now: 36 * 60_000, request });
  expect(count).toBe(2);
});
test("concurrent launches issue one request and 304 retains the index", async () => {
  await fixture();
  let count = 0;
  const request = (async (_url: RequestInfo | URL, options?: RequestInit) => {
    count++;
    if (count === 1) {
      await new Promise(resolve => setTimeout(resolve, 20));
      return Response.json(value, { headers: { etag: '"v1"' } });
    }
    expect(new Headers(options?.headers).get("if-none-match")).toBe('"v1"');
    return new Response(null, { status: 304 });
  }) as unknown as typeof fetch;
  await Promise.all(Array.from({ length: 15 }, () =>
    cachedFeed<typeof value>(url, { root, now: 0, request })));
  expect(count).toBe(1);
  expect(await cachedFeed<typeof value>(url, { root, now: 36 * 60_000, request }))
    .toEqual(value);
  expect(count).toBe(2);
});
test("network failure backs off for an hour without blocking app use", async () => {
  await fixture();
  let count = 0;
  const request = (async () => { count++; throw new Error("offline"); }) as unknown as typeof fetch;
  await cachedFeed<typeof value>(url, { root, now: 0, request });
  await cachedFeed<typeof value>(url, { root, now: 59 * 60_000, request });
  expect(count).toBe(1);
  await cachedFeed<typeof value>(url, { root, now: 60 * 60_000, request });
  expect(count).toBe(2);
});
test("release sets include dependencies and only the current native platform", () => {
  const packages: EngineFeed["packages"] = {};
  for (const name of ["cli", "agent", "runtime", "worker", "webview"]) {
    packages[`@luon/${name}`] = { version: "1.0.0", dependencies: [] };
  }
  packages["@luon/webview"]!.dependencies = ["@luon/mac", "@luon/windows"];
  packages["@luon/mac"] = { version: "1.0.1", dependencies: [],
    os: ["darwin"], cpu: ["arm64"] };
  packages["@luon/windows"] = { version: "1.0.2", dependencies: [],
    os: ["win32"], cpu: ["x64"] };
  const set = engineSet({ format: 1, revision: "x", packages }, "darwin", "arm64");
  expect(set["@luon/mac"]).toBe("1.0.1");
  expect(set["@luon/windows"]).toBeUndefined();
});
test("installation validates before switching and rolls back a failed switch", async () => {
  await fixture();
  const stateRoot = join(root, "state");
  await mkdir(join(root, "node_modules"));
  await Bun.write(join(root, "node_modules/old"), "old");
  await Bun.write(join(root, "package.json"), '{"dependencies":{}}');
  await Bun.write(join(root, "bun.lock"), "old lock");
  const packages = { "@luon/cli": "1.0.0" };
  const run = async (args: string[], cwd?: string) => {
    if (args[0] === "install") {
      expect(args).toContain("--force");
      expect(args).toContain("--no-cache");
      await Bun.write(join(cwd!, "node_modules/@luon/cli/package.json"),
        JSON.stringify({ name: "@luon/cli", version: "1.0.0" }));
      await Bun.write(join(cwd!, "bun.lock"), "new lock");
      return "";
    }
    return '{"cli":"1.0.0"}';
  };
  // A receipt failure after directory replacement must restore the old install.
  await mkdir(join(stateRoot, "installed.json"), { recursive: true });
  await expect(installSet(packages, { root, stateRoot, run })).rejects.toThrow();
  expect(await Bun.file(join(root, "node_modules/old")).text()).toBe("old");
  expect(await Bun.file(join(root, "bun.lock")).text()).toBe("old lock");
  await rm(join(stateRoot, "installed.json"), { recursive: true });
  await installSet(packages, { root, stateRoot, run });
  expect(await Bun.file(join(root, "node_modules/old")).exists()).toBe(false);
  expect(await Bun.file(join(root, "bun.lock")).text()).toBe("new lock");
  expect(await readState(join(stateRoot, "installed.json")))
    .toMatchObject({ packages });
});
test("prompt escapes app text and offers dismissal without timed installation", () => {
  const html = patchPage("<script>bad()</script>", "A & B", "token");
  expect(html).toContain("&lt;script&gt;");
  expect(html).toContain("Do not show for 24 hours");
  expect(html).toContain("seconds=60");
  expect(html).toContain("if(seconds<=0)choose('later')");
});


test("accepted app copies work offline and reject tampered copies", async () => {
  await fixture();
  const original = join(root, "original.luon");
  const copy = join(root, "accepted.luon");
  await Bun.write(original, "first release");
  await Bun.write(copy, "accepted release");
  const hash = (text: string) => new Bun.CryptoHasher("sha256")
    .update(text).digest("hex");
  await Bun.write(join(root, `copy-${hash("first release")}.json`),
    JSON.stringify({ path: copy, hash: hash("accepted release") }));
  expect(await savedApp(original, root)).toBe(copy);
  expect(await Bun.file(original).text()).toBe("first release");
  await Bun.write(copy, "tampered release");
  expect(await savedApp(original, root)).toBe(original);
});
test("opted-out apps return before any file or network access", async () => {
  const path = "/does-not-exist.luon";
  expect(await patchApp(path, { autoPatch: false } as LuonManifest)).toBe(path);
});


test("only explicit 24-hour notices hide the next launch", async () => {
  await fixture();
  const file = join(root, "notice.json");
  const now = Date.now();
  const hour = 60 * 60 * 1000;
  expect(await noticeHidden(file, now)).toBe(false);
  for (const [duration, expected] of [[1, false], [24, true]] as const) {
    await Bun.write(file, JSON.stringify({ until: now + duration * hour }));
    await utimes(file, new Date(now), new Date(now));
    expect(await noticeHidden(file, now)).toBe(expected);
  }
  await Bun.write(file, JSON.stringify({ until: now + 24 * hour, snooze: true }));
  expect(await noticeHidden(file, now)).toBe(true);
  expect(await noticeHidden(file, now + 24 * hour)).toBe(false);
});
