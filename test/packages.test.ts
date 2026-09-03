import { describe, expect, test } from "bun:test";

import { latestPackages } from "../src/packages.ts";

describe("Site packages", () => {
  test("moves installed Luon packages to latest", () => {
    const result = latestPackages({
      dependencies: {
        "@luon/runtime": "0.1.20",
        "@luon/ui": "latest",
        react: "19.2.8",
      },
      devDependencies: { "@luon/cli": "^0.1.5" },
    });

    expect(result.names).toEqual([
      "@luon/cli",
      "@luon/runtime",
      "@luon/ui",
    ]);
    expect(result.value.dependencies?.["@luon/runtime"]).toBe("latest");
    expect(result.value.devDependencies?.["@luon/cli"]).toBe("latest");
    expect(result.value.dependencies?.react).toBe("19.2.8");
  });

  test("preserves local workspace packages", () => {
    const result = latestPackages({
      dependencies: { "@luon/runtime": "workspace:*" },
    });
    expect(result).toMatchObject({ changed: false, names: [] });
  });
});
