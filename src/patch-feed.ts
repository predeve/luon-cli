import { join } from "node:path";
import { patchLock, patchRoot, readState, writeState } from "./patch-state";

export type EngineFeed = {
  format: 1; revision: string;
  packages: Record<string, {
    version: string; dependencies: string[]; os?: string[]; cpu?: string[];
  }>;
};
export type AppRelease = {
  hash: string; size: number; version: string; url: string;
  known?: string[];
};
export type AppFeed = { format: 1; apps: Record<string, AppRelease> };
type Cache = { next: number; etag?: string; value?: unknown };
export const engineUrl = "https://pkg.luon.dev/releases.json.gz";
export const storeUrl = "https://store.luon.dev/releases.json.gz";
const period = 30 * 60 * 1000;

export async function cachedFeed<T>(url: string, options: {
  root?: string; now?: number; request?: typeof fetch; force?: boolean;
} = {}): Promise<T | undefined> {
  const root = options.root || patchRoot;
  const key = new Bun.CryptoHasher("sha256").update(url).digest("hex");
  const file = join(root, `${key}.json`);
  const now = options.now ?? Date.now();
  let cache = await readState<Cache>(file);
  if (!options.force && cache && cache.next > now) return cache.value as T;
  const unlock = await patchLock(key, root);
  if (!unlock) {
    if (options.force) throw new Error("Another release check is in progress.");
    return cache?.value as T;
  }
  try {
    cache = await readState<Cache>(file);
    if (!options.force && cache && cache.next > now) return cache.value as T;
    const target = new URL(url);
    // Explicit user actions bypass CDN freshness as well as the local timer.
    if (options.force) {
      target.searchParams.set("check", `${now}-${crypto.randomUUID()}`);
    }
    const response = await (options.request || fetch)(target.href, {
      headers: !options.force && cache?.etag ? { "if-none-match": cache.etag } : {},
      signal: AbortSignal.timeout(options.force ? 10_000 : 2_000), redirect: "error",
    });
    if (response.status === 304 && cache?.value) {
      cache.next = now + period + Math.random() * 5 * 60 * 1000;
    } else {
      if (!response.ok) throw new Error("Release index unavailable.");
      if (Number(response.headers.get("content-length")) > 4 * 1024 * 1024) {
        throw new Error("Release index is too large.");
      }
      const text = await response.text();
      if (text.length > 4 * 1024 * 1024) throw new Error("Index too large.");
      const value = JSON.parse(text);
      if (value?.format !== 1) throw new Error("Unknown release index.");
      cache = { value, etag: response.headers.get("etag") || undefined,
        next: now + period + Math.random() * 5 * 60 * 1000 };
    }
    await writeState(file, cache);
    return cache.value as T;
  } catch (error) {
    await writeState(file, { ...cache, next: now + 60 * 60 * 1000 });
    if (options.force) throw error;
    return cache?.value as T;
  } finally { await unlock(); }
}

export function engineSet(feed: EngineFeed,
  platform = process.platform, arch = process.arch) {
  const result: Record<string, string> = {};
  const add = (name: string) => {
    if (result[name]) return;
    const item = feed.packages?.[name];
    if (!item || !/^@luon\/[a-z0-9-]+$/.test(name)
      || !/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(item.version)
      || !Array.isArray(item.dependencies)
      || (item.os !== undefined && !Array.isArray(item.os))
      || (item.cpu !== undefined && !Array.isArray(item.cpu))) {
      throw new Error("Invalid Luon release set.");
    }
    if (item.os && !item.os.includes(platform)
      || item.cpu && !item.cpu.includes(arch)) return;
    result[name] = item.version;
    for (const dependency of item.dependencies || []) add(dependency);
  };
  for (const name of ["cli", "agent", "runtime", "worker", "webview"]) {
    add(`@luon/${name}`);
  }
  return result;
}
