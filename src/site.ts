import { resolve } from "node:path";

import type { WorkerSite } from "@luon/worker/local";

export async function workerSite(
  root: string,
  databaseUrl = process.env.DATABASE_URL,
) {
  const pkg = await Bun.file(resolve(root, "package.json")).json()
    .catch(() => ({})) as { data?: unknown };
  const local = pkg.data === "local";
  return {
    cache: local ? "local" : "server",
    cachePath: local ? ".config/data/cache" : undefined,
    databaseUrl,
    id: process.env.LUON_RUN_SITE || root,
    pglite: databaseUrl ? undefined : ".config/data/pglite",
    redisUrl: local ? undefined : process.env.REDIS_URL,
    root,
    timezone: process.env.TZ || "UTC",
  } satisfies WorkerSite;
}
