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
    expect(parseArgs(["app", "open", "luon://app/preview?manifest=x"]))
      .toMatchObject({ appAction: "open", command: "app" });
    expect(parseArgs(["stop", "site"]))
      .toMatchObject({ command: "stop", root: "site" });
    expect(parseArgs(["login"])).toMatchObject({ command: "login" });
    expect(parseArgs(["logout"])).toMatchObject({ command: "logout" });
  });

  test("rejects unknown commands and invalid options", () => {
    expect(() => parseArgs(["serve"])).toThrow("Unknown Luon command");
    expect(() => parseArgs(["build", "--open"]))
      .toThrow("Unknown option");
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
    expect(() => parseArgs(["login", "site"]))
      .toThrow("does not accept arguments");
    expect(() => parseArgs(["version", "site"]))
      .toThrow("Unknown option");
  });
});
