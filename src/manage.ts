import { timingSafeEqual } from "node:crypto";
import {
  chmod,
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:net";
import { dirname } from "node:path";

import type { LocalWorker } from "@luon/worker/local";
import { WorkerClient } from "@luon/worker/client";

type ManageOptions = {
  close(): void;
  file: string;
  heartbeat: string;
  pipe: string;
  port: number;
  runtime: number;
  site: string;
  token: string;
  worker: LocalWorker;
};

type RunState = {
  pid: number;
  pipe: string;
  port: number;
  runtime: number;
  site: string;
  token: string;
  version: 1;
};

const maxSize = 16 * 1024;

function equal(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function save(file: string, state: RunState) {
  await mkdir(dirname(file), { mode: 0o700, recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  await writeFile(temp, `${JSON.stringify(state, null, 2)}\n`, {
    mode: 0o600,
  });
  await rename(temp, file);
}

async function owned(file: string, token: string) {
  const value = await readFile(file, "utf8").catch(() => "");
  try {
    return equal((JSON.parse(value) as { token?: string }).token || "", token);
  } catch {
    return false;
  }
}

export async function manageRun(options: ManageOptions) {
  if (!options.file || !options.pipe || options.token.length < 24) return;
  if (process.platform !== "win32") await rm(options.pipe, { force: true });
  const state: RunState = {
    pid: process.pid,
    pipe: options.pipe,
    port: options.port,
    runtime: options.runtime,
    site: options.site,
    token: options.token,
    version: 1,
  };
  const server = createServer((socket) => {
    socket.setEncoding("utf8");
    let value = "";
    socket.on("data", (chunk) => {
      value += chunk;
      if (value.length > maxSize) {
        socket.destroy();
        return;
      }
      const end = value.indexOf("\n");
      if (end < 0) return;
      socket.pause();
      void Promise.resolve().then(async () => {
        try {
          const input = JSON.parse(value.slice(0, end)) as {
            action?: string;
            args?: string[];
            command?: string;
            key?: string;
            token?: string;
          };
          if (!equal(input.token || "", options.token)) throw new Error();
          if (input.action === "status") {
            socket.end(`${JSON.stringify({
              ok: true,
              pid: process.pid,
              port: options.port,
              runtime: options.runtime,
              site: options.site,
              worker: await options.worker.health(),
            })}\n`);
            return;
          }
          if (input.action === "stop") {
            socket.end(`${JSON.stringify({ ok: true })}\n`);
            setTimeout(options.close, 0);
            return;
          }
          if (
            input.action === "cache-list"
            || input.action === "cache-delete"
            || input.action === "cache-clear"
            || input.action === "cache-send"
          ) {
            const client = new WorkerClient({
              pipe: options.worker.pipe,
              site: options.worker.site,
              token: options.worker.token,
            });
            const part = input.action.slice("cache-".length);
            const data = await client.request(`/api/v1/cache/${part}`, {
              ...(part === "delete" ? { key: input.key } : {}),
              ...(part === "send" ? {
                args: input.args,
                command: input.command,
              } : {}),
            });
            socket.end(`${JSON.stringify({ data, ok: true })}\n`);
            return;
          }
          throw new Error();
        } catch {
          socket.end(`${JSON.stringify({ ok: false })}\n`);
        }
      });
    });
  });
  await mkdir(dirname(options.pipe), { mode: 0o700, recursive: true });
  await new Promise<void>((done, fail) => {
    server.once("error", fail);
    server.listen(options.pipe, () => {
      server.off("error", fail);
      done();
    });
  });
  if (process.platform !== "win32") await chmod(options.pipe, 0o600);
  await save(options.file, state);
  const grace = Math.max(
    10_000,
    Number(process.env.LUON_CORE_GRACE_MS || 5 * 60_000),
  );
  let checking = false;
  const timer = setInterval(() => {
    if (checking) return;
    checking = true;
    void stat(options.heartbeat).then((info) => {
      if (Date.now() - info.mtimeMs > grace) options.close();
    }, () => {
      options.close();
    }).finally(() => {
      checking = false;
    });
  }, 10_000);
  timer.unref();
  return async () => {
    clearInterval(timer);
    await new Promise<void>((done) => server.close(() => done()));
    if (!await owned(options.file, options.token)) return;
    await rm(options.file, { force: true });
    if (process.platform !== "win32") {
      await rm(options.pipe, { force: true });
    }
  };
}
