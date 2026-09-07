import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { cliCommand, keepPackage } from "../src/relaunch";

test("retained package survives moving the download and reopens without copying itself",
  async () => {
    const root = await mkdtemp(resolve(import.meta.dir,
      "../../../luon-temp/keep-test-"));
    try {
      const source = join(root, "Original app.luon");
      await Bun.write(source, "saved package bytes");
      const target = await keepPackage(source, root);
      await rm(source);
      expect(await readFile(target, "utf8")).toBe("saved package bytes");
      expect(await keepPackage(target, root)).toBe(target);
      expect(await readFile(target, "utf8")).toBe("saved package bytes");
      expect((await stat(target)).mode & 0o777).toBe(0o600);
      expect(cliCommand(["file", target, "--webview"]).slice(-3))
        .toEqual(["file", target, "--webview"]);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
