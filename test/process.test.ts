import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { logRoot } from "../src/log.ts";
import { findPort } from "../src/process.ts";
import { workerSite } from "../src/site.ts";

const database = process.env.DATABASE_URL;
const redis = process.env.REDIS_URL;
const timezone = process.env.TZ;
const configDir = process.env.LUON_CONFIG_DIR;
const logDir = process.env.LUON_LOG_ROOT;
const runSite = process.env.LUON_RUN_SITE;
const roots: string[] = [];

afterEach(async () => {
  if (database === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = database;
  if (redis === undefined) delete process.env.REDIS_URL;
  else process.env.REDIS_URL = redis;
  if (timezone === undefined) delete process.env.TZ;
  else process.env.TZ = timezone;
  if (configDir === undefined) delete process.env.LUON_CONFIG_DIR;
  else process.env.LUON_CONFIG_DIR = configDir;
  if (logDir === undefined) delete process.env.LUON_LOG_ROOT;
  else process.env.LUON_LOG_ROOT = logDir;
  if (runSite === undefined) delete process.env.LUON_RUN_SITE;
  else process.env.LUON_RUN_SITE = runSite;
  await Promise.all(roots.splice(0).map((root) => (
    rm(root, { force: true, recursive: true })
  )));
});

describe("CLI paths", () => {
  test("keeps external logs under the Luon home", () => {
    delete process.env.LUON_LOG_ROOT;
    process.env.LUON_CONFIG_DIR = join("/tmp", "luon-home");
    expect(logRoot()).toBe(join("/tmp", "luon-home", "logs"));
    process.env.LUON_LOG_ROOT = join("/tmp", "custom-logs");
    expect(logRoot()).toBe(join("/tmp", "custom-logs"));
  });

  test("keeps the production supervisor entry lightweight", async () => {
    const main = await Bun.file(join(import.meta.dir, "../src/main.ts")).text();
    const process = await Bun.file(
      join(import.meta.dir, "../src/process.ts"),
    ).text();
    const imports = main.split("\n").filter((line) => (
      line.startsWith("import ")
    )).join("\n");

    expect(imports).not.toContain("@luon/runtime");
    expect(imports).not.toContain("@luon/worker");
    expect(process).toContain('from "@luon/runtime/db-sync"');
    expect(process).toContain('from "@luon/worker/local"');
    expect(process).not.toContain('from "@luon/runtime/project"');
  });
});

describe("CLI Worker site", () => {
  test("uses the managed Site code as the Worker id", async () => {
    process.env.LUON_RUN_SITE = "web-one";
    expect((await workerSite("/app")).id).toBe("web-one");
    delete process.env.LUON_RUN_SITE;
  });

  test("uses PGlite without a PostgreSQL URL", async () => {
    delete process.env.DATABASE_URL;
    delete process.env.REDIS_URL;
    process.env.TZ = "Asia/Seoul";
    expect(await workerSite("/app")).toEqual({
      cache: "server",
      cachePath: undefined,
      databaseUrl: undefined,
      id: "/app",
      pglite: ".config/data/pglite",
      redisUrl: undefined,
      root: "/app",
      timezone: "Asia/Seoul",
    });
  });

  test("uses configured PostgreSQL and Redis", async () => {
    process.env.DATABASE_URL = "postgresql://database";
    process.env.REDIS_URL = "redis://cache";
    expect(await workerSite("/app")).toMatchObject({
      databaseUrl: "postgresql://database",
      pglite: undefined,
      redisUrl: "redis://cache",
    });
  });

  test("uses the local PGlite cache without Redis", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "luon-cli-cache-"));
    roots.push(root);
    await Bun.write(resolve(root, "package.json"), '{"data":"local"}\n');
    process.env.REDIS_URL = "redis://cache";
    expect(await workerSite(root)).toMatchObject({
      cache: "local",
      cachePath: ".config/data/cache",
      redisUrl: undefined,
    });
  });
});

describe("CLI Site port", () => {
  test("skips a port already used on loopback", async () => {
    const server = Bun.serve({
      fetch: () => new Response("occupied"),
      hostname: "127.0.0.1",
      port: 0,
    });
    try {
      const port = server.port!;
      expect(await findPort(port, port + 1)).toBe(port + 1);
    } finally {
      await server.stop(true);
    }
  });
});
