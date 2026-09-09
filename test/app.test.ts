import { afterEach, describe, expect, test } from "bun:test";

import {
  iconSource,
  launchUrl,
  openApp,
  sendSiteAuth,
  validSiteId,
  viewOptions,
} from "../src/app";

let server: ReturnType<typeof Bun.serve> | undefined;

afterEach(() => {
  server?.stop(true);
  server = undefined;
});

describe("CLI App launcher", () => {
  test("refreshes remote icons across app releases", async () => {
    let icon = '<svg xmlns="http://www.w3.org/2000/svg">old</svg>';
    const cache = new Map<string, string>();
    server = Bun.serve({
      port: 0,
      fetch(request) {
        const url = new URL(request.url);
        expect(url.pathname).toBe("/preview/favicon.svg");
        const body = cache.get(url.href) ?? icon;
        cache.set(url.href, body);
        return new Response(body, {
          headers: { "content-type": "image/svg+xml" },
        });
      },
    });
    const page = new URL("/preview/", server.url);
    const first = await iconSource("image:favicon.svg", page, {});
    icon = '<svg xmlns="http://www.w3.org/2000/svg">feather</svg>';
    const second = await iconSource("image:favicon.svg", page, {});
    expect(Buffer.from(first!.data!).toString()).toContain("old");
    expect(Buffer.from(second!.data!).toString()).toContain("feather");
    expect(cache.size).toBe(2);
  });

  test("forwards native browser compatibility settings", () => {
    const url = new URL("https://example.com");
    const options = viewOptions({
      id: "browser", title: "Browser", url: url.href,
      window: { network: "direct", userAgent: "native", theme: "light",
        browserControl: true, mcpActive: true },
    }, url, undefined, undefined);
    expect(options.browserControl).toBe(true);
    expect(options.mcp).toBe(true);
    expect(options.network).toBe("direct");
    expect(options.userAgent).toBe("native");
    expect(options.theme).toBe("light");
  });

  test("reads singleInstance only from the window configuration", () => {
    const url = new URL("https://app.luon.dev/b08cce6cb5ed");
    for (const value of [undefined, false, true, "true"]) {
      const manifest = {
        id: "app-b08cce6cb5ed",
        title: "Example",
        url: url.href,
        window: { singleInstance: value },
      };
      const options = viewOptions(manifest, url, undefined, undefined);
      expect(options.singleInstance).toBe(
        typeof value === "boolean" ? value : undefined,
      );
    }
  });

  test("accepts WEB and APP Site identities", () => {
    expect(validSiteId("web-b572bf27da39")).toBeTrue();
    expect(validSiteId("app-d6eafa1eb253")).toBeTrue();
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

  test("carries one trusted App launch with the installation check", () => {
    const callback = `https://www.luon.dev/api/cli/check/${"a".repeat(43)}`;
    const target = "luon://app-b08cce6cb5ed.luon.dev";
    const url = new URL("luon://app/check");
    url.searchParams.set("callback", callback);
    url.searchParams.set("launch", target);
    expect(launchUrl(url.toString())).toEqual({
      callback,
      kind: "check",
      target,
    });
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
