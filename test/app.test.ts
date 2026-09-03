import { afterEach, describe, expect, test } from "bun:test";

import { openApp } from "../src/app";

let server: ReturnType<typeof Bun.serve> | undefined;

afterEach(() => {
  server?.stop(true);
  server = undefined;
});

describe("CLI App launcher", () => {
  test("confirms a trusted loopback installation check", async () => {
    let confirmed = false;
    server = Bun.serve({
      fetch(request) {
        confirmed = request.method === "POST";
        return Response.json({ ready: true });
      },
      hostname: "127.0.0.1",
      port: 0,
    });
    const token = "a".repeat(43);
    const callback = `http://127.0.0.1:${server.port}/api/cli/check/${token}`;
    const url = new URL("luon://app/check");
    url.searchParams.set("callback", callback);
    await openApp(url.toString());
    expect(confirmed).toBeTrue();
  });

  test("rejects an untrusted installation callback", async () => {
    const url = new URL("luon://app/check");
    url.searchParams.set(
      "callback",
      `https://example.com/api/cli/check/${"a".repeat(43)}`,
    );
    await expect(openApp(url.toString())).rejects.toThrow("not trusted");
  });
});
