import { describe, expect, test } from "bun:test";

import {
  cliLevel,
  latestCli,
  serverState,
} from "../src/launch-check.ts";

function reply(state: string, status: number) {
  return async () => Response.json({ state }, { status });
}

describe("app launch checks", () => {
  test("classifies server-backed Site states", async () => {
    expect(await serverState("https://web-test.luon.dev", reply("ready", 200)))
      .toBe("ready");
    expect(await serverState("https://web-test.luon.dev", reply("missing", 404)))
      .toBe("missing");
    expect(await serverState("https://web-test.luon.dev", reply("stopped", 409)))
      .toBe("stopped");
    expect(await serverState(
      "https://web-test.luon.dev",
      reply("unavailable", 503),
    )).toBe("unavailable");
  });

  test("continues when the server status request fails", async () => {
    const request = (async () => {
      throw new TypeError("offline");
    });
    expect(await serverState("https://web-test.luon.dev", request))
      .toBe("unavailable");
  });

  test("detects only a newer published CLI version", async () => {
    const current = reply("unused", 200);
    const request = (async () => Response.json({
      "dist-tags": { latest: "0.4.0" },
    }));
    expect(await latestCli("0.3.56", request)).toBe("0.4.0");
    expect(await latestCli("0.4.0", request)).toBeUndefined();
    expect(await latestCli("0.5.0", request)).toBeUndefined();
    expect(await latestCli("0.3.56", current)).toBeUndefined();
  });

  test("classifies CLI updates by semantic version position", () => {
    expect(cliLevel("0.3.60", "0.3.61")).toBe("patch");
    expect(cliLevel("0.3.60", "0.4.0")).toBe("minor");
    expect(cliLevel("0.3.60", "1.0.0")).toBe("major");
    expect(cliLevel("0.3.60", "0.3.60")).toBeUndefined();
    expect(cliLevel("1.0.0", "0.9.0")).toBeUndefined();
  });
});
