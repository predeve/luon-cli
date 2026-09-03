import { randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir, hostname } from "node:os";
import { join } from "node:path";

import type { Account } from "./account.ts";

type Send = (input: string | URL | Request, init?: RequestInit) =>
  Promise<Response>;

type Device = {
  id: string;
  version: 1;
};

const idRule = /^[A-Za-z0-9_-]{43}$/;

function configDir() {
  return process.env.LUON_CONFIG_DIR
    || join(homedir(), ".luon");
}

function deviceFile() {
  return join(configDir(), "device.json");
}

async function readDevice() {
  try {
    const value = JSON.parse(await readFile(deviceFile(), "utf8")) as Device;
    return value.version === 1 && idRule.test(value.id) ? value : undefined;
  } catch {
    return;
  }
}

async function ensureDevice() {
  const saved = await readDevice();
  if (saved) return saved;
  const device: Device = {
    id: randomBytes(32).toString("base64url"),
    version: 1,
  };
  await mkdir(configDir(), { mode: 0o700, recursive: true });
  await chmod(configDir(), 0o700);
  await writeFile(deviceFile(), `${JSON.stringify(device, null, 2)}\n`, {
    mode: 0o600,
  });
  await chmod(deviceFile(), 0o600);
  return device;
}

async function cliVersion() {
  const file = new URL("../package.json", import.meta.url);
  const value = await Bun.file(file).json() as { version?: unknown };
  return typeof value.version === "string" ? value.version : "unknown";
}

export async function registerDevice(
  account?: Account,
  send: Send = fetch,
) {
  const device = await ensureDevice();
  const connected = account || await import("./account.ts")
    .then((value) => value.readAccount());
  if (!connected) return false;
  const response = await send(new URL("/api/cli/devices", connected.url), {
    body: JSON.stringify({
      arch: process.arch,
      id: device.id,
      launcher: true,
      name: hostname().slice(0, 120) || "Luon device",
      platform: process.platform,
      version: await cliVersion(),
    }),
    headers: {
      authorization: `Bearer ${connected.token}`,
      "content-type": "application/json",
    },
    method: "POST",
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    throw new Error(`Luon device registration failed (${response.status}).`);
  }
  return true;
}

export async function syncDevice(account: Account, send: Send = fetch) {
  return await readDevice() ? registerDevice(account, send) : false;
}

export async function unregisterDevice(account: Account, send: Send = fetch) {
  const device = await readDevice();
  if (!device) return false;
  const target = new URL("/api/cli/devices", account.url);
  target.searchParams.set("id", device.id);
  const response = await send(target, {
    headers: { authorization: `Bearer ${account.token}` },
    method: "DELETE",
    signal: AbortSignal.timeout(10_000),
  });
  return response.ok;
}
