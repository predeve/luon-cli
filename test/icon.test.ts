import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildIcon } from "../src/icon.ts";

const root = await mkdtemp(join(tmpdir(), "luon-icon-"));
const source = join(root, "source.svg");

await writeFile(source, `<svg xmlns="http://www.w3.org/2000/svg"
  viewBox="0 0 1024 1024">
  <rect width="1024" height="1024" rx="220" fill="#2563eb"/>
</svg>`);

afterAll(async () => {
  await rm(root, { force: true, recursive: true });
});

describe("CLI App icons", () => {
  test("builds and caches each platform format", async () => {
    const mac = await buildIcon(source, "darwin", root);
    const linux = await buildIcon(source, "linux", root);
    const windows = await buildIcon(source, "win32", root);
    expect(mac).toEndWith(".icns");
    expect(linux).toEndWith(".png");
    expect(windows).toEndWith(".ico");
    expect((await readFile(mac!)).subarray(0, 4).toString()).toBe("icns");
    expect((await readFile(linux!)).subarray(1, 4).toString()).toBe("PNG");
    expect((await readFile(windows!)).readUInt16LE(2)).toBe(1);
    expect(await buildIcon(source, "darwin", root)).toBe(mac);
  });
});
