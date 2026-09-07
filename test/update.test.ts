import { describe, expect, test } from "bun:test";

import {
  installTargets,
  parseVersions,
  targetVersions,
  updateCli,
  webviewName,
} from "../src/update.ts";

const current = {
  agent: "0.1.5",
  cli: "0.1.5",
  runtime: "0.1.13",
  worker: "0.1.2",
};
const target = {
  agent: "0.1.6",
  cli: "0.1.6",
  runtime: "0.1.14",
  worker: "0.1.3",
};
const meta = {
  agent: {
    "dist-tags": { latest: target.agent },
    versions: { [target.agent]: {} },
  },
  cli: {
    "dist-tags": { latest: target.cli },
    versions: { [target.cli]: {} },
  },
  runtime: {
    "dist-tags": { latest: target.runtime },
    versions: { [target.runtime]: {} },
  },
  worker: {
    "dist-tags": { latest: target.worker },
    versions: { [target.worker]: {} },
  },
};

describe("CLI update", () => {
  test("refreshes the native package even when CLI versions match", async () => {
    const packages = await installTargets(target, async (id) => {
      const version = id === "@luon/webview" ? "0.3.17" : "0.3.14";
      return {
        "dist-tags": { latest: version },
        versions: { [version]: {} },
      };
    }, "win32", "x64");
    expect(packages["@luon/cli"]).toBe(target.cli);
    expect(packages["@luon/webview"]).toBe("0.3.17");
    expect(packages["@luon/webview-windows-amd64"]).toBe("0.3.14");
    expect(Object.keys(packages)).toHaveLength(6);
    expect(webviewName("darwin", "arm64"))
      .toBe("@luon/webview-macos-arm64");
    expect(webviewName("linux", "arm64"))
      .toBe("@luon/webview-linux-arm64");
    expect(webviewName("darwin", "x64")).toBe("");
    await expect(installTargets(target, async () => ({
      "dist-tags": { latest: "0.3.14" }, versions: {},
    }))).rejects.toThrow("Could not determine");
  });

  test("reads each latest Luon package version", () => {
    expect(targetVersions(meta)).toEqual(target);
    expect(parseVersions(
      "Luon CLI 0.1.6 · Agent 0.1.6 · Runtime 0.1.14 · Worker 0.1.3\n",
    )).toEqual(target);
    expect(parseVersions(JSON.stringify(target))).toEqual(target);
  });

  test("installs and verifies all latest Luon packages", async () => {
    let installs = 0;
    await updateCli({ check: false, current }, {
      install: async () => {
        installs += 1;
      },
      installed: async () => target,
      metadata: async () => meta,
    });
    expect(installs).toBe(1);
  });

  test("checks without installing", async () => {
    let installs = 0;
    await updateCli({ check: true, current }, {
      install: async () => {
        installs += 1;
      },
      metadata: async () => meta,
    });
    expect(installs).toBe(0);
  });

  test("force installs even when every package is current", async () => {
    let installs = 0;
    await updateCli({ check: false, current: target }, {
      install: async () => {
        installs += 1;
      },
      installed: async () => target,
      metadata: async () => meta,
    });
    expect(installs).toBe(1);
  });
});
