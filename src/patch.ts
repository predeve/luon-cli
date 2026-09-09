import { mkdir, rename, rm } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { readLuon, type LuonManifest } from "@luon/runtime/luon-file";
import { readAccount } from "./account";
import { cachedFeed, engineSet, engineUrl, storeUrl,
  type AppFeed, type AppRelease, type EngineFeed } from "./patch-feed";
import { offerPatch } from "./patch-dialog";
import { engineChanges, globalCli, installSet } from "./patch-install";
import { patchLock, patchRoot, readState, writeState } from "./patch-state";
import { showToast } from "./notice";

export async function patchEngine(): Promise<boolean> {
  if (process.env.LUON_PATCH_DONE === "1" || process.env.LUON_STANDALONE === "1") {
    return false;
  }
  try {
    const feed = await cachedFeed<EngineFeed>(engineUrl);
    if (!feed) return false;
    const packages = engineSet(feed);
    if (!(await engineChanges(packages)).length) return false;
    const { readAuto } = await import("./auto-update");
    if (!(await readAuto()).active
      && !await offerPatch("engine", "Luon update available",
      "Update the Luon components together.\nYour app data and logins are kept.")) {
      return false;
    }
    // Refresh the small index only after the user chooses installation.
    const latest = await cachedFeed<EngineFeed>(engineUrl, { force: true });
    await installSet(engineSet(latest || feed));
    const child = Bun.spawn([globalCli(), ...process.argv.slice(2)], {
      env: { ...process.env, LUON_PATCH_DONE: "1" },
      stdin: "inherit", stdout: "inherit", stderr: "inherit",
    });
    process.exitCode = await child.exited;
    return true;
  } catch (error) {
    console.error("Luon update:", error instanceof Error ? error.message : error);
    return false;
  }
}

function validRelease(value: AppRelease | undefined): value is AppRelease {
  return Boolean(value && /^[a-f0-9]{64}$/.test(value.hash)
    && Number.isSafeInteger(value.size) && value.size > 0
    && value.size <= 500 * 1024 * 1024 && typeof value.version === "string"
    && typeof value.url === "string");
}
type AppCopy = { path: string; hash: string };
const fileHash = async (path: string) => new Bun.CryptoHasher("sha256")
  .update(await Bun.file(path).bytes()).digest("hex");
async function copyPath(copy?: AppCopy, root = patchRoot) {
  if (!copy || !resolve(copy.path).startsWith(`${resolve(root)}${sep}`)) {
    return undefined;
  }
  return await fileHash(copy.path).catch(() => "") === copy.hash
    ? copy.path : undefined;
}
export async function savedApp(path: string, root = patchRoot) {
  // Resolve only accepted updates. The original file remains untouched.
  const visited = new Set<string>();
  for (let depth = 0; depth < 32; depth++) {
    const hash = await fileHash(path).catch(() => "");
    if (!hash || visited.has(hash)) break;
    visited.add(hash);
    const copy = await readState<AppCopy>(join(root, `copy-${hash}.json`));
    const next = await copyPath(copy, root);
    if (!next) break;
    path = next;
  }
  return path;
}
async function trustedFeed(url: string) {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || parsed.username || parsed.password
    || parsed.pathname !== "/releases.json.gz") return false;
  if (["luon.dev", "store.luon.dev"].includes(parsed.hostname)) return true;
  return (await readAccount())?.url === parsed.origin;
}
async function download(release: AppRelease, feed: string,
  request: typeof fetch = fetch) {
  const url = new URL(release.url, feed);
  if (url.origin !== new URL(feed).origin || url.username || url.password) {
    throw new Error("The update download origin is invalid.");
  }
  const account = await readAccount();
  const headers: Record<string, string> = {};
  if (account?.url === url.origin) headers.authorization = `Bearer ${account.token}`;
  const response = await request(url, { headers, redirect: "error",
    signal: AbortSignal.timeout(120_000) });
  if (!response.ok || !response.body) throw new Error("App update unavailable.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > release.size) throw new Error("App update size mismatch.");
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  if (total !== release.size || new Bun.CryptoHasher("sha256")
    .update(bytes).digest("hex") !== release.hash) {
    throw new Error("App update integrity check failed.");
  }
  return bytes;
}

export type PatchOptions = {
  manual?: boolean;
  check?: boolean;
  root?: string;
  request?: typeof fetch;
  feeds?: Map<string, Promise<AppFeed | undefined>>;
  offer?: typeof offerPatch;
};

export async function patchApp(path: string, manifest: LuonManifest,
  options: PatchOptions = {}) {
  const manual = options.manual === true;
  const stateRoot = options.root || patchRoot;
  if (!manual && (manifest.autoPatch === false
    || process.env.LUON_STANDALONE === "1")) return path;
  const readFeed = (url: string) => {
    let pending = options.feeds?.get(url);
    if (!pending) {
      pending = cachedFeed<AppFeed>(url, { force: true,
        root: stateRoot, request: options.request });
      options.feeds?.set(url, pending);
    }
    return pending;
  };
  let unlock: (() => Promise<void>) | undefined;
  let installing = false;
  try {
    const hash = await fileHash(path);
    // Store registration takes precedence over an embedded My Sites source.
    let feedUrl = storeUrl;
    let feed = await readFeed(feedUrl);
    let found = Object.entries(feed?.apps || {}).find(([, app]) =>
      validRelease(app) && (app.hash === hash
        || (Array.isArray(app.known) && app.known.includes(hash))));
    if (!found && manifest.patch && await trustedFeed(manifest.patch.feed)) {
      feedUrl = manifest.patch.feed;
      feed = await readFeed(feedUrl);
      const app = feed?.apps?.[manifest.patch.key];
      if (app) found = [manifest.patch.key, app];
    }
    if (!found || !validRelease(found[1])) {
      return path;
    }
    const [key, release] = found;
    if (release.hash === hash) {
      return path;
    }
    if (options.check) {
      if (manual) console.log(`${manifest.title}: `
        + `${manifest.version} → ${release.version}`);
      return path;
    }
    const scope = new Bun.CryptoHasher("sha256").update(`${feedUrl}:${key}`)
      .digest("hex");
    const receipt = join(stateRoot, `app-${scope}.json`);
    const cached = await readState<{ path: string; hash: string }>(receipt);
    const existing = cached?.hash === release.hash
      ? await copyPath(cached, stateRoot) : undefined;
    if (existing) {
      await writeState(join(stateRoot, `copy-${hash}.json`), cached);
      return existing;
    }
    const { readAuto } = await import("./auto-update");
    const auto = await readAuto(stateRoot);
    if (!manual && !(auto.active && auto.apps)
      && !await (options.offer || offerPatch)(
      `app-${scope}`, `${manifest.title}: update available`,
      `${manifest.version} → ${release.version}\nUpdate this app before opening it?`)) {
      return path;
    }
    installing = true;
    unlock = await patchLock(`app-${scope}`, stateRoot);
    if (!unlock) {
      if (manual) throw new Error("Another app update is in progress.");
      return path;
    }
    const latest = manual ? feed : await cachedFeed<AppFeed>(feedUrl,
      { force: true, root: stateRoot, request: options.request });
    const target = latest?.apps?.[key];
    if (!validRelease(target)) throw new Error("Invalid app release.");
    const value = feedUrl === manifest.patch?.feed
      ? { ...target, url: `/api/sites/${manifest.id}/patch/${target.hash}` }
      : target;
    const bytes = await download(value, feedUrl, options.request);
    const pkg = await readLuon(bytes);
    if (pkg.manifest.id !== manifest.id
      || pkg.manifest.version !== target.version) {
      throw new Error("App release identity or version changed.");
    }
    const root = join(stateRoot, "apps", scope);
    await mkdir(root, { recursive: true, mode: 0o700 });
    const file = join(root, `${target.hash}.luon`);
    const temp = `${file}.${process.pid}.next`;
    try { await Bun.write(temp, bytes); await rename(temp, file); }
    finally { await rm(temp, { force: true }); }
    const copy = { path: file, hash: target.hash };
    await writeState(receipt, copy);
    await writeState(join(stateRoot, `copy-${hash}.json`), copy);
    return file;
  } catch (error) {
    if (manual) throw error;
    console.error("App update:", error instanceof Error ? error.message : error);
    if (installing) void showToast({ title: "Update could not be installed",
      message: "Opening the existing app. Try again later.", tone: "warning" });
    return path;
  } finally { await unlock?.(); }
}
