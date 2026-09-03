import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

export type Account = {
  token: string;
  url: string;
  version: 1;
};

type Open = (url: string) => Promise<void> | void;
type Send = (input: string | URL | Request, init?: RequestInit) =>
  Promise<Response>;

const tokenRule = /^luon_[A-Za-z0-9_-]{43}$/;
const stateRule = /^[a-f0-9]{64}$/;

function accountDir() {
  return process.env.LUON_CONFIG_DIR || join(homedir(), ".luon");
}

function accountFile() {
  return join(accountDir(), "account.json");
}

function coreUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Luon Core URL is invalid.");
  }
  const local = ["127.0.0.1", "localhost", "::1"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) {
    throw new Error("Luon Core URL must use HTTPS or local HTTP.");
  }
  if (url.username || url.password) {
    throw new Error("Luon Core URL must not include credentials.");
  }
  return url.origin;
}

function parseAccount(value: unknown): Account | undefined {
  if (!value || typeof value !== "object") return;
  const item = value as Partial<Account>;
  if (item.version !== 1 || !tokenRule.test(item.token || "")) return;
  try {
    return { token: item.token!, url: coreUrl(item.url || ""), version: 1 };
  } catch {
    return;
  }
}

export async function readAccount() {
  try {
    return parseAccount(JSON.parse(await readFile(accountFile(), "utf8")));
  } catch {
    return;
  }
}

async function saveAccount(account: Account) {
  await mkdir(accountDir(), { mode: 0o700, recursive: true });
  await chmod(accountDir(), 0o700);
  await writeFile(accountFile(), `${JSON.stringify(account, null, 2)}\n`, {
    mode: 0o600,
  });
  await chmod(accountFile(), 0o600);
}

async function openBrowser(url: string) {
  const command = process.platform === "darwin"
    ? ["open", url]
    : process.platform === "win32"
      ? ["cmd", "/c", "start", "", url]
      : ["xdg-open", url];
  const child = Bun.spawn(command, { stderr: "ignore", stdout: "ignore" });
  if (await child.exited !== 0) {
    throw new Error(`Open this URL in a browser:\n${url}`);
  }
}

export async function login(open: Open = openBrowser, send: Send = fetch) {
  const state = randomBytes(32).toString("hex");
  const base = coreUrl(
    process.env.LUON_CORE_URL || "https://www.luon.dev",
  );
  let accept!: (account: Account) => void;
  let reject!: (error: Error) => void;
  const result = new Promise<Account>((resolve, fail) => {
    accept = resolve;
    reject = fail;
  });
  const server = createServer((request, response) => {
    const url = new URL(request.url || "/", "http://127.0.0.1");
    const token = url.searchParams.get("token") || "";
    const returned = url.searchParams.get("state") || "";
    const remote = url.searchParams.get("server") || "";
    if (
      request.method !== "GET"
      || url.pathname !== "/callback"
      || !stateRule.test(returned)
      || returned !== state
      || !tokenRule.test(token)
    ) {
      response.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
      response.end("Luon CLI login request is invalid.");
      return;
    }
    try {
      const account: Account = { token, url: coreUrl(remote), version: 1 };
      response.writeHead(200, {
        "cache-control": "no-store",
        "content-type": "text/html; charset=utf-8",
        "referrer-policy": "no-referrer",
      });
      response.end("<!doctype html><title>Luon CLI connected</title>"
        + "<p>Luon CLI is connected. You can close this window.</p>");
      accept(account);
    } catch (error) {
      response.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
      response.end("Luon Core URL is invalid.");
      reject(error as Error);
    }
  });
  await new Promise<void>((resolve, fail) => {
    server.once("error", fail);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("Luon CLI callback server could not start.");
  }
  const callback = `http://127.0.0.1:${address.port}/callback`;
  const target = new URL("/cli/login", base);
  target.searchParams.set("callback", callback);
  target.searchParams.set("state", state);
  console.log(`Continue Luon login in your browser:\n${target}`);
  const timer = setTimeout(() => {
    reject(new Error("Luon CLI login timed out."));
  }, 5 * 60_000);
  try {
    await open(target.toString());
    const account = await result;
    await saveAccount(account);
    const { syncDevice } = await import("./device.ts");
    await syncDevice(account, send).catch((error) => {
      console.warn(error instanceof Error ? error.message : String(error));
    });
    console.log(`Luon CLI connected to ${account.url}`);
    return account;
  } finally {
    clearTimeout(timer);
    server.close();
  }
}

export async function logout(send: Send = fetch) {
  const account = await readAccount();
  if (account) {
    try {
      const { unregisterDevice } = await import("./device.ts");
      await unregisterDevice(account, send);
      const response = await send(new URL("/api/auth/logout", account.url), {
        headers: { authorization: `Bearer ${account.token}` },
        method: "POST",
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) {
        console.warn(`Core token revocation failed (${response.status}).`);
      }
    } catch {
      console.warn("Core could not be reached; removing the local login only.");
    }
  }
  await rm(accountFile(), { force: true });
  console.log("Luon CLI logout complete.");
}
