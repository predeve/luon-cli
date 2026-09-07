import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { refreshApps } from "../src/webview-update.ts";

test("updates cached app engines without changing launch data", async () => {
  const root = await mkdtemp(resolve(import.meta.dir,
    "../../../luon-temp/webview-update-"));
  try {
    const bin = join(root, "engine");
    const apps = join(root, "apps");
    await Bun.write(bin, "new engine");
    expect(await refreshApps(bin, apps)).toBe(0);
    const contents = join(apps, "app-one", "Browser.app", "Contents");
    const file = join(contents, "MacOS", "Luon WebView");
    const launch = join(contents, "Resources", "launch.json");
    await mkdir(join(contents, "MacOS"), { recursive: true });
    await Bun.write(file, "old engine");
    await Bun.write(launch, '{"command":["/bin/bun"]}');
    await symlink(join(apps, "app-one"), join(apps, "alias"));
    expect(await refreshApps(bin, apps)).toBe(1);
    expect(await Bun.file(file).text()).toBe("new engine");
    expect(await Bun.file(launch).text()).toBe('{"command":["/bin/bun"]}');
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});
