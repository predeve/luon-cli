import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import { join } from "node:path";

import {
  registerDevice,
  syncDevice,
  unregisterDevice,
} from "../src/device.ts";

const tempRoot = join(import.meta.dir, "../../../luon-temp");
const priorDir = process.env.LUON_CONFIG_DIR;
let folder = "";

afterEach(async () => {
  if (priorDir === undefined) delete process.env.LUON_CONFIG_DIR;
  else process.env.LUON_CONFIG_DIR = priorDir;
  if (folder) await rm(folder, { force: true, recursive: true });
  folder = "";
});

test("registers one stable local App device with its Core account", async () => {
  await mkdir(tempRoot, { recursive: true });
  folder = await mkdtemp(join(tempRoot, "cli-device-"));
  process.env.LUON_CONFIG_DIR = folder;
  const account = {
    token: `luon_${"a".repeat(43)}`,
    url: "https://core.luon.dev",
    version: 1 as const,
  };
  const requests: Request[] = [];
  const send = async (input: string | URL | Request, init?: RequestInit) => {
    requests.push(new Request(input, init));
    return Response.json({ ready: true });
  };
  expect(await registerDevice(account, send)).toBeTrue();
  expect(await syncDevice(account, send)).toBeTrue();
  expect(await unregisterDevice(account, send)).toBeTrue();
  expect(requests.map((item) => item.method)).toEqual([
    "POST",
    "POST",
    "DELETE",
  ]);
  const first = await requests[0]!.json() as Record<string, unknown>;
  const second = await requests[1]!.json() as Record<string, unknown>;
  expect(first.id).toBe(second.id);
  expect(first.launcher).toBeTrue();
  expect(requests[0]!.headers.get("authorization"))
    .toBe(`Bearer ${account.token}`);
  expect((await stat(join(folder, "device.json"))).mode & 0o777).toBe(0o600);
});
