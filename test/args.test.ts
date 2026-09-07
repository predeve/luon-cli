import { describe, expect, test } from "bun:test";

import { parseArgs } from "../src/args.ts";

describe("CLI arguments", () => {
  test("parses Cake-style path and options", () => {
    expect(parseArgs(["dev", "site", "--port", "6100", "--open"]))
      .toEqual({
        command: "dev",
        open: true,
        port: 6100,
        root: "site",
        yes: false,
      });
    expect(parseArgs(["build"])).toEqual({
      command: "build",
      open: false,
      port: undefined,
      root: ".",
      yes: false,
    });
    expect(parseArgs(["export", "app-product"]))
      .toMatchObject({ command: "export", site: "app-product" });
    expect(parseArgs(["help", "dev"]).topic).toBe("dev");
    expect(parseArgs(["-v"])).toMatchObject({
      command: "version",
      detail: true,
    });
    expect(parseArgs(["--version"])).toMatchObject({
      command: "version",
      detail: false,
    });
    expect(parseArgs(["version", "--json"]))
      .toMatchObject({ command: "version", json: true });
    expect(parseArgs(["prepare", "site"]).command).toBe("prepare");
    expect(parseArgs(["update", "--check"]))
      .toMatchObject({ check: true, command: "update" });
    expect(parseArgs(["agent", "open"]))
      .toMatchObject({ action: "open", command: "agent" });
    expect(parseArgs(["agent", "install"]))
      .toMatchObject({ action: "install", command: "agent" });
    expect(parseArgs(["app", "install"]))
      .toMatchObject({ appAction: "install", command: "app" });
    expect(parseArgs(["app", "check"]))
      .toMatchObject({ appAction: "check", command: "app" });
    expect(parseArgs(["app", "build", "product.luon"]))
      .toMatchObject({ appAction: "build", root: "product.luon" });
    expect(parseArgs([
      "app",
      "build",
      "product.luon",
      "--out",
      "Product",
      "--target",
      "windows-x64",
    ])).toMatchObject({
      appAction: "build",
      output: "Product",
      target: "windows-x64",
    });
    expect(parseArgs(["app", "open", "luon://app.luon.dev/b08cce6cb5ed"]))
      .toMatchObject({ appAction: "open", command: "app" });
    expect(parseArgs(["stop", "site"]))
      .toMatchObject({ command: "stop", root: "site" });
    expect(parseArgs(["login"])).toMatchObject({ command: "login" });
    expect(parseArgs(["logout"])).toMatchObject({ command: "logout" });
    expect(parseArgs(["product.luon"])).toMatchObject({
      command: "file",
      root: "product.luon",
      view: "webview",
    });
    expect(parseArgs(["product.luon", "--browser"]).view).toBe("browser");
    expect(parseArgs(["file", "product.luon", "--headless"]).view)
      .toBe("headless");
    expect(parseArgs(["file:///tmp/product.luon", "--view", "webview"]))
      .toMatchObject({ command: "file", view: "webview" });
  });

  test("rejects unknown commands and invalid options", () => {
    expect(() => parseArgs(["serve"])).toThrow("Unknown Luon command");
    expect(() => parseArgs(["build", "--open"]))
      .toThrow("Unknown option");
    expect(() => parseArgs(["export"]))
      .toThrow("luon export <site-id>");
    expect(() => parseArgs(["export", "invalid-site"]))
      .toThrow("luon export <site-id>");
    expect(() => parseArgs(["dev", "--port", "70000"]))
      .toThrow("between 1 and 65535");
    expect(() => parseArgs(["dev", "--open", "site"]))
      .toThrow("path before command options");
    expect(() => parseArgs(["ui", "add"]))
      .toThrow("Unknown Luon command");
    expect(() => parseArgs(["update", "site"]))
      .toThrow("Unknown option");
    expect(() => parseArgs(["agent", "launch"]))
      .toThrow("Unknown action");
    expect(() => parseArgs(["app", "launch"]))
      .toThrow("Unknown action");
    expect(() => parseArgs(["app", "build", "product.zip"]))
      .toThrow("luon app build");
    expect(() => parseArgs(["app", "build", "product.luon", "--force"]))
      .toThrow("luon app build");
    expect(() => parseArgs([
      "app",
      "build",
      "product.luon",
      "--target",
      "windows-32",
    ])).toThrow("luon app build");
    expect(() => parseArgs(["login", "site"]))
      .toThrow("does not accept arguments");
    expect(() => parseArgs(["version", "site"]))
      .toThrow("Unknown option");
    expect(() => parseArgs(["product.luon", "--desktop"]))
      .toThrow("Unknown .luon option");
    expect(() => parseArgs(["file"]))
      .toThrow("Use luon file");
  });
});
