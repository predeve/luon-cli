import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";

import { appIcons, appOutput, appTarget } from "../src/standalone.ts";

describe("standalone app output", () => {
  test("uses the package title and platform suffix", () => {
    expect(appOutput("/tmp/product.luon", "My App", undefined, "darwin"))
      .toBe(resolve("My App.app"));
    expect(appOutput("/tmp/product.luon", "My App", undefined, "win32"))
      .toBe(resolve("My App.exe"));
  });

  test("normalizes custom output suffixes", () => {
    expect(appOutput("/tmp/product.luon", "App", "/tmp/out", "win32"))
      .toBe("/tmp/out.exe");
    expect(appOutput("/tmp/product.luon", "App", "/tmp/out.exe", "win32"))
      .toBe("/tmp/out.exe");
  });

  test("sanitizes generated names", () => {
    expect(appOutput("/tmp/product.luon", "Bad:/Name. ", undefined, "linux"))
      .toBe(resolve("Bad--Name"));
  });

  test("maps cross-compile targets", () => {
    expect(appTarget("windows-x86")).toMatchObject({
      arch: "x64",
      bun: "bun-windows-x64",
      native: "@luon/webview-windows-x86",
      platform: "win32",
    });
    expect(appTarget("linux-arm")).toMatchObject({
      arch: "arm64",
      bun: "bun-linux-arm64",
      native: "@luon/webview-linux-arm",
      platform: "linux",
    });
  });
});

describe("standalone app icons", () => {
  test("resolves Lucide system and state icons before compiling", async () => {
    const icons = appIcons({
      manifest: {
        app: {
          icons: {
            playing: "lucide:music",
          },
          window: {
            systemIcon: "lucide:music-2",
          },
        },
      },
    } as never);

    expect(icons.map(([spec]) => spec)).toEqual([
      "lucide:music-2",
      "lucide:music",
    ]);
    expect(await Promise.all(icons.map(([, path]) => (
      Bun.file(path).exists()
    )))).toEqual([true, true]);
  });
});
