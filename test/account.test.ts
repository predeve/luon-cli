import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import { join } from "node:path";

import { login, logout, readAccount } from "../src/account.ts";

const tempRoot = join(import.meta.dir, "../../../luon-temp");
const priorDir = process.env.LUON_CONFIG_DIR;
const priorCore = process.env.LUON_CORE_URL;
let folder = "";

afterEach(async () => {
  if (priorDir === undefined) delete process.env.LUON_CONFIG_DIR;
  else process.env.LUON_CONFIG_DIR = priorDir;
  if (priorCore === undefined) delete process.env.LUON_CORE_URL;
  else process.env.LUON_CORE_URL = priorCore;
  if (folder) await rm(folder, { force: true, recursive: true });
  folder = "";
});

describe("CLI account", () => {
  test("connects through a loopback callback and revokes the token", async () => {
    await mkdir(tempRoot, { recursive: true });
    folder = await mkdtemp(join(tempRoot, "cli-account-"));
    process.env.LUON_CONFIG_DIR = folder;
    process.env.LUON_CORE_URL = "http://127.0.0.1:6020";
    const token = `luon_${"a".repeat(43)}`;
    const account = await login(async (target) => {
      const page = new URL(target);
      expect(page.origin).toBe("http://127.0.0.1:6020");
      expect(page.pathname).toBe("/cli/login");
      const callback = new URL(page.searchParams.get("callback")!);
      callback.searchParams.set("server", "https://core.luon.dev");
      callback.searchParams.set("state", page.searchParams.get("state")!);
      callback.searchParams.set("token", token);
      expect((await fetch(callback)).status).toBe(200);
    });
    expect(account).toEqual({
      token,
      url: "https://core.luon.dev",
      version: 1,
    });
    expect(await readAccount()).toEqual(account);
    expect((await stat(join(folder, "account.json"))).mode & 0o777)
      .toBe(0o600);

    let request: Request | undefined;
    await logout(async (input, init) => {
      request = new Request(input, init);
      return new Response(null, { status: 200 });
    });
    expect(request?.url).toBe("https://core.luon.dev/api/auth/logout");
    expect(request?.method).toBe("POST");
    expect(request?.headers.get("authorization")).toBe(`Bearer ${token}`);
    expect(await readAccount()).toBeUndefined();
  });
});
