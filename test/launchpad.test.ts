import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { packLuon, readLuon, writeLuon } from "@luon/runtime/luon-file";
import { launchpad, noteLaunch, localLaunch } from "../src/launchpad";
import { keepPackage } from "../src/relaunch";

test("Launchpad discovers retained apps after originals are removed", async () => {
  const root = await mkdtemp(resolve("luon-temp/launchpad-test-"));
  const previous = process.env.LUON_CLI_ENTRY;
  try {
    const project = join(root, "project");
    await Bun.write(join(project, "package.json"), '{"title":"Example App"}');
    await Bun.write(join(project, "dist/luon.json"), '{"mode":"static"}');
    await Bun.write(join(project, "dist/app/index.html"), "example");
    const archive = await packLuon({ root: project, id: "app-example",
      type: "app", name: "Example App", version: "1" });
    const original = join(root, "Downloads.luon");
    await Bun.write(original, await archive.bytes());
    const folder = join(root, "app/example");
    await mkdir(folder, { recursive: true });
    await keepPackage(original, folder);
    await rm(original);
    await noteLaunch(folder);
    const calls: string[][] = [];
    const library = launchpad(root, async args => { calls.push(args); });
    const first = (await library.list()).apps[0]!;
    expect(first.id).toBe("app-example");
    expect(first.version).toBe("1");
    expect(first.opened).not.toBe("");
    const pkg = await readLuon(Bun.file(first.path));
    const newer = await writeLuon({ ...pkg,
      manifest: { ...pkg.manifest, version: "2" } });
    await Bun.write(original, await newer.bytes());
    await keepPackage(original, folder);
    await noteLaunch(folder);
    const updated = (await library.list()).apps[0]!;
    expect(updated.version).toBe("2");
    expect(updated.registered).toBe(first.registered);
    process.env.LUON_CLI_ENTRY = join(root, "cli.ts");
    await Bun.write(process.env.LUON_CLI_ENTRY, "");
    await library.action(first.id, "open");
    expect(calls[0]).toEqual([process.execPath, process.env.LUON_CLI_ENTRY,
      "file", first.path, "--webview"]);
    await expect(library.action("app-../../outside", "open"))
      .rejects.toThrow("identity");
    await symlink(folder, join(root, "app/linked"));
    await expect(library.action("app-linked", "open"))
      .rejects.toThrow("links");
    expect((await library.list()).apps).toHaveLength(1);
  } finally {
    if (previous === undefined) delete process.env.LUON_CLI_ENTRY;
    else process.env.LUON_CLI_ENTRY = previous;
    await rm(root, { recursive: true, force: true });
  }
});

test("Launchpad denies remote origins and editor previews", () => {
  const entry = process.env.LUON_CLI_ENTRY;
  const editor = process.env.LUON_EDITOR;
  process.env.LUON_CLI_ENTRY = "/fixture/cli.ts";
  delete process.env.LUON_EDITOR;
  try {
    expect(localLaunch(new Request("http://localhost:6100/api/apps"))).toBe(true);
    expect(localLaunch(new Request("https://example.com/api/apps"))).toBe(false);
    expect(localLaunch(new Request("http://localhost:6100/api/apps", {
      headers: { origin: "https://example.com" },
    }))).toBe(false);
    process.env.LUON_EDITOR = "1";
    expect(localLaunch(new Request("http://localhost:6100/api/apps"))).toBe(false);
  } finally {
    if (entry === undefined) delete process.env.LUON_CLI_ENTRY;
    else process.env.LUON_CLI_ENTRY = entry;
    if (editor === undefined) delete process.env.LUON_EDITOR;
    else process.env.LUON_EDITOR = editor;
  }
});
