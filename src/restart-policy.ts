import type { UpdatePolicy } from "@luon/runtime/update-policy";
import { updatePolicy } from "@luon/runtime/update-policy";
import { patchLock, patchRoot, readState, writeState } from "./patch-state";
import { join } from "node:path";

export type UserPolicy = Omit<UpdatePolicy, "apply"> & {
  apply?: UpdatePolicy["apply"] | "default";
};
export function userPolicy(value: unknown): UserPolicy {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw Error("Invalid restart settings.");
  }
  const item = value as UserPolicy;
  return { ...updatePolicy({ ...item,
    apply: item.apply === "default" ? undefined : item.apply }),
    ...(item.apply === "default" ? { apply: "default" as const } : {}) };
}
export function resolvePolicy(app: UpdatePolicy | undefined,
  global: UserPolicy, local?: UserPolicy): Required<UpdatePolicy> {
  const apply = local?.apply && local.apply !== "default" ? local.apply
    : global.apply && global.apply !== "default" ? global.apply
    : app?.apply ?? "next-launch";
  return { apply, at: local?.at ?? global.at ?? app?.at ?? "05:00",
    spread: local?.spread ?? global.spread ?? app?.spread ?? 30 };
}
export async function deviceSeed(root = patchRoot): Promise<string> {
  const file = join(root, "device.json");
  const before = await readState<{ id: string }>(file);
  if (before?.id) return before.id;
  const unlock = await patchLock("device", root);
  if (!unlock) throw Error("Device update identity is being initialized.");
  try {
    const saved = await readState<{ id: string }>(file);
    if (saved?.id) return saved.id;
    const id = crypto.randomUUID();
    await writeState(file, { id });
    return id;
  } finally { await unlock(); }
}
// Local calendar days, including windows crossing midnight. Never catch up
// outside the window. Date constructors follow the device timezone and DST.
export function restartSlot(now: Date, policy: Required<UpdatePolicy>,
  seed: string, id: string) {
  const [hour, minute] = policy.at.split(":").map(Number);
  for (const day of [0, -1]) {
    const start = new Date(now.getFullYear(), now.getMonth(),
      now.getDate() + day, hour, minute);
    const end = new Date(start.getTime() + policy.spread * 60_000);
    if (now < start || now >= end) continue;
    const key = `${seed}:${id}:${start.getTime()}`;
    const hash = new Bun.CryptoHasher("sha256").update(key).digest("hex");
    const offset = parseInt(hash.slice(0, 8), 16) / 0x100000000;
    // Reserve a small retry margin near the end of the window.
    return { due: start.getTime() + offset * Math.max(0,
      policy.spread * 60_000 - 15_000), end: end.getTime() };
  }
}
