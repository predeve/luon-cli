import {
  chmodSync,
  closeSync,
  createWriteStream,
  mkdirSync,
  openSync,
  type WriteStream,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

type Output = {
  error: WriteStream;
  out: WriteStream;
};

export function logRoot() {
  if (process.env.LUON_LOG_ROOT) return process.env.LUON_LOG_ROOT;
  const home = process.env.LUON_CONFIG_DIR || join(homedir(), ".luon");
  return join(home, "logs");
}

export function openLogs(): Output | undefined {
  if (process.env.LUON_LOG_CAPTURED === "1") return;
  const dir = join(logRoot(), "cli");
  mkdirSync(dir, { mode: 0o700, recursive: true });
  const error = join(dir, "error.log");
  const out = join(dir, "out.log");
  for (const file of [error, out]) {
    closeSync(openSync(file, "a", 0o600));
    chmodSync(file, 0o600);
  }
  return {
    error: createWriteStream(error, {
      flags: "a",
      mode: 0o600,
    }),
    out: createWriteStream(out, {
      flags: "a",
      mode: 0o600,
    }),
  };
}

function close(file: WriteStream) {
  return new Promise<void>((done, fail) => {
    file.once("error", fail);
    file.end(done);
  });
}

export async function relay(
  input: ReadableStream<Uint8Array>,
  output: NodeJS.WriteStream,
  file: WriteStream,
) {
  const reader = input.getReader();
  try {
    while (true) {
      const item = await reader.read();
      if (item.done) break;
      output.write(item.value);
      file.write(item.value);
    }
  } finally {
    reader.releaseLock();
    await close(file);
  }
}
