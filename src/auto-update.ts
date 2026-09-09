import { userPolicy, type UserPolicy } from "./restart-policy";
import { join } from "node:path";
import { appendFile, mkdir } from "node:fs/promises";
import { logRoot } from "./log";
import { patchLock, patchRoot, readState, writeState } from "./patch-state";
import { cachedFeed, engineSet, engineUrl, type EngineFeed } from "./patch-feed";
import { engineChanges, installSet } from "./patch-install";
import { updateApps } from "./update-apps";
import { autoStartup } from "./auto-start";

export type AutoConfig = { active: boolean; hours: number; apps: boolean;
  restart?: UserPolicy; overrides?: Record<string, UserPolicy>; };
export const autoDefaults: AutoConfig = { active: false, hours: 6, apps: true };
const configFile = (root = patchRoot) => join(root, "auto.json");
const stateFile = (root = patchRoot) => join(root, "auto-state.json");
const startupFile = (root = patchRoot) => join(root, "auto-start.json");
export async function readAuto(root = patchRoot): Promise<AutoConfig> {
  const saved = await readState<AutoConfig>(configFile(root));
  return { active: saved?.active === true, apps: saved?.apps !== false,
    hours: [1, 6, 24].includes(saved?.hours!) ? saved!.hours : 6,
    ...(saved?.restart ? { restart: userPolicy(saved.restart) } : {}),
    ...(saved?.overrides ? { overrides: saved.overrides } : {}) };
}

export async function syncAuto(options: {
  root?: string; startup?: typeof autoStartup;
} = {}) {
  const root = options.root || patchRoot;
  if (!(await readAuto(root)).active) return;
  if ((await readState<{ version: number }>(startupFile(root)))?.version === 3) {
    return;
  }
  const unlock = await patchLock("auto-settings", root);
  if (!unlock) return;
  try {
    if (!(await readAuto(root)).active) return;
    if ((await readState<{ version: number }>(startupFile(root)))?.version === 3) {
      return;
    }
    await (options.startup || autoStartup)(true, true);
    await writeState(startupFile(root), { version: 3 });
  } finally { await unlock(); }
}

export async function saveAuto(input: AutoConfig, options: {
  root?: string; startup?: typeof autoStartup;
} = {}) {
  const root = options.root || patchRoot;
  if (typeof input.active !== "boolean" || typeof input.apps !== "boolean"
    || ![1, 6, 24].includes(input.hours)) throw new Error("Invalid update settings.");
  const restart = input.restart === undefined ? undefined
    : userPolicy(input.restart);
  const overrides: Record<string, UserPolicy> = {};
  if (input.overrides && (typeof input.overrides !== "object"
    || Array.isArray(input.overrides))) throw Error("Invalid app settings.");
  for (const [id, policy] of Object.entries(input.overrides ?? {})) {
    if (!/^(app|web)-[a-z0-9-]{1,64}$/.test(id)) {
      throw Error("Invalid app identity.");
    }
    overrides[id] = userPolicy(policy);
  }
  input = { active: input.active, hours: input.hours, apps: input.apps,
    ...(restart ? { restart } : {}),
    ...(input.overrides ? { overrides } : {}) };
  const unlock = await patchLock("auto-settings", root);
  if (!unlock) throw new Error("Update settings are being saved. Try again.");
  try {
    const before = await readAuto(root);
    await (options.startup || autoStartup)(input.active);
    await writeState(configFile(root), input);
    await writeState(startupFile(root), { version: 3 });
    if (!before.active || before.hours !== input.hours) {
      await writeState(stateFile(root), { next: Date.now() + input.hours * 3_600_000
          + Math.floor(Math.random() * 900_000) });
    }
  } finally { await unlock(); }
}

async function applyAuto(config: AutoConfig) {
  const feed = await cachedFeed<EngineFeed>(engineUrl, { force: true });
  if (!feed) throw new Error("Release index unavailable.");
  const packages = engineSet(feed);
  if ((await engineChanges(packages)).length) await installSet(packages);
  if (config.apps) await updateApps(false, { automatic: true });
}

export async function runAuto(options: {
  root?: string; now?: number; apply?: typeof applyAuto; random?: () => number;
} = {}) {
  const root = options.root || patchRoot;
  const now = options.now ?? Date.now();
  const config = await readAuto(root);
  if (!config.active) return;
  const unlock = await patchLock("auto-run", root);
  if (!unlock) return;
  let attempted = false;
  try {
    // Login registration may launch us before its settings save completes.
    const settings = await patchLock("auto-settings", root);
    if (!settings) return;
    await settings();
    const state = await readState<{ next: number }>(stateFile(root));
    if (state?.next! > now) return;
    if (!(await readAuto(root)).active) return;
    attempted = true;
    if (!options.apply) {
      await Bun.sleep(Math.floor(Math.random() * 50_000));
      if (!(await readAuto(root)).active) return;
    }
    await (options.apply || applyAuto)(await readAuto(root));
  } catch (error) {
    if (!options.apply) {
      const dir = join(logRoot(), "cli");
      await mkdir(dir, { recursive: true, mode: 0o700 });
      await appendFile(join(dir, "auto-update-error.log"),
        `${new Date().toISOString()} ${String(error)}\n`, { mode: 0o600 });
    }
    throw error;
  } finally {
    try {
      if (attempted) await writeState(stateFile(root), {
        next: now + config.hours * 3_600_000 + (options.random ?? Math.random)() * 900_000,
      });
    } finally { await unlock(); }
  }
}
