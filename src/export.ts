import { stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { readAccount, type Account } from "./account.ts";

type Send = (input: string | URL | Request, init?: RequestInit) =>
  Promise<Response>;

const siteRule = /^(?:web|app)-[a-z0-9-]{1,64}$/;

function stamp(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error("Invalid build time.");
  const part = (number: number) => String(number).padStart(2, "0");
  return `${date.getFullYear()}${part(date.getMonth() + 1)}`
    + `${part(date.getDate())}${part(date.getHours())}`
    + `${part(date.getMinutes())}${part(date.getSeconds())}`;
}

function title(value: string, fallback: string) {
  const source = value.normalize("NFC")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
  const encoder = new TextEncoder();
  let result = "";
  for (const part of source) {
    if (encoder.encode(result + part).byteLength > 160) break;
    result += part;
  }
  return result.replace(/[. ]+$/g, "") || fallback;
}

async function freePath(name: string, root: string) {
  const base = resolve(root, name);
  if (!await stat(base).catch(() => undefined)) return base;
  for (let index = 2; index < 10_000; index += 1) {
    const path = resolve(root, name.replace(/\.luon$/, `-${index}.luon`));
    if (!await stat(path).catch(() => undefined)) return path;
  }
  throw new Error("A free .luon export filename could not be found.");
}

async function message(response: Response) {
  const value = await response.json().catch(() => ({})) as { message?: unknown };
  return typeof value.message === "string" && value.message
    ? value.message
    : `Luon export failed (HTTP ${response.status}).`;
}

export async function exportSite(
  site: string,
  options: {
    account?: Account | null;
    root?: string;
    send?: Send;
  } = {},
) {
  if (!siteRule.test(site)) throw new Error("Use a valid Luon Site ID.");
  const account = options.account === undefined
    ? await readAccount()
    : options.account;
  if (!account) throw new Error("Run luon login before exporting a .luon file.");
  const send = options.send || fetch;
  const response = await send(new URL(`/api/sites/${site}/export`, account.url), {
    body: "{}",
    headers: {
      authorization: `Bearer ${account.token}`,
      "content-type": "application/json",
    },
    method: "POST",
    signal: AbortSignal.timeout(10 * 60_000),
  });
  if (!response.ok) throw new Error(await message(response));
  const builtAt = response.headers.get("x-luon-built-at") || "";
  const rawTitle = response.headers.get("x-luon-site-title") || "";
  let siteTitle = site;
  try {
    siteTitle = decodeURIComponent(rawTitle) || site;
  } catch {
    siteTitle = site;
  }
  const name = `${stamp(builtAt)}_${title(siteTitle, site)}.luon`;
  const path = await freePath(name, options.root || process.cwd());
  await writeFile(path, new Uint8Array(await response.arrayBuffer()), {
    flag: "wx",
  });
  console.log(`Luon export complete: ${path}`);
  return path;
}
