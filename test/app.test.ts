import { afterEach, describe, expect, test } from "bun:test";

import {
  launchUrl,
  openApp,
  sendSiteAuth,
  validSiteId,
} from "../src/app";

let server: ReturnType<typeof Bun.serve> | undefined;

afterEach(() => {
  server?.stop(true);
  server = undefined;
});

describe("CLI App launcher", () => {
  test("accepts WEB, APP and BOT Site identities", () => {
    expect(validSiteId("web-b572bf27da39")).toBeTrue();
    expect(validSiteId("app-d6eafa1eb253")).toBeTrue();
    expect(validSiteId("bot-d6eafa1eb253")).toBeTrue();
    expect(validSiteId("tmp-03c1da262b80")).toBeFalse();
  });

  test("sends account auth through each Site shortcut", () => {
    const account = { url: "https://core.example.com" };
    expect(sendSiteAuth(account, new URL("https://app.luon.dev/one/manifest")))
      .toBeTrue();
    expect(sendSiteAuth(account, new URL("https://core.example.com/manifest")))
      .toBeTrue();
    expect(sendSiteAuth(account, new URL("https://web.luon.dev/manifest")))
      .toBeTrue();
    expect(sendSiteAuth(account, new URL("https://bot.luon.dev/manifest")))
      .toBeTrue();
    expect(sendSiteAuth(account, new URL(
      "https://tmp.luon.dev/03c1da262b80/manifest",
    ))).toBeTrue();
    expect(sendSiteAuth(account, new URL(
      "http://tmp.localhost:6010/03c1da262b80/manifest",
    ))).toBeFalse();
    expect(sendSiteAuth(account, new URL("https://site.example/manifest")))
      .toBeFalse();
  });

  test("resolves short and direct Site launch addresses", () => {
    const web = "https://web.luon.dev/b572bf27da39/manifest";
    expect(launchUrl("luon://web.luon.dev/b572bf27da39"))
      .toEqual({ kind: "open", manifest: web });
    expect(launchUrl("luon://web-b572bf27da39.luon.dev"))
      .toEqual({ kind: "open", manifest: web });
    const manifest = "https://app.luon.dev/b08cce6cb5ed/manifest";
    expect(launchUrl("luon://app.luon.dev/b08cce6cb5ed"))
      .toEqual({ kind: "open", manifest });
    expect(launchUrl("luon://app-b08cce6cb5ed.luon.dev"))
      .toEqual({ kind: "open", manifest });
    expect(launchUrl("luon://bot-b08cce6cb5ed.luon.dev"))
      .toEqual({
        kind: "open",
        manifest: "https://bot.luon.dev/b08cce6cb5ed/manifest",
      });
    expect(launchUrl("luon://app.localhost:6010/b08cce6cb5ed"))
      .toEqual({
        kind: "open",
        manifest: "http://app.localhost:6010/b08cce6cb5ed/manifest",
      });
    expect(launchUrl("luon://app-b08cce6cb5ed.localhost:6010"))
      .toEqual({
        kind: "open",
        manifest: "http://app.localhost:6010/b08cce6cb5ed/manifest",
      });
    expect(launchUrl("luon://tmp.luon.dev/03c1da262b80"))
      .toEqual({
        kind: "open",
        manifest: "https://tmp.luon.dev/03c1da262b80/manifest",
      });
    expect(launchUrl("luon://tmp.localhost:6010/a50f488928d9"))
      .toEqual({
        kind: "open",
        manifest: "http://tmp.localhost:6010/a50f488928d9/manifest",
      });
    expect(() => launchUrl(
      "luon://app/preview?manifest=https://app.luon.dev/old/manifest",
    )).toThrow("invalid");
  });

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
