import { describe, expect, test } from "bun:test";

import {
  parseVersions,
  targetVersions,
  updateCli,
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
