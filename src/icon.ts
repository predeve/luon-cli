import {
  chmod,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import sharp from "sharp";

type IconKind = "icns" | "ico" | "png";

function iconKind(platform: NodeJS.Platform): IconKind | undefined {
  if (platform === "darwin") return "icns";
  if (platform === "linux") return "png";
  if (platform === "win32") return "ico";
}

function chunk(type: string, data: Uint8Array) {
  const result = Buffer.alloc(8 + data.byteLength);
  result.write(type, 0, 4, "ascii");
  result.writeUInt32BE(result.byteLength, 4);
  Buffer.from(data).copy(result, 8);
  return result;
}

function icns(images: Map<number, Uint8Array>) {
  const rows = [
    ["ic04", 16],
    ["ic11", 32],
    ["ic05", 32],
    ["ic12", 64],
    ["ic07", 128],
    ["ic13", 256],
    ["ic08", 256],
    ["ic14", 512],
    ["ic09", 512],
    ["ic10", 1024],
  ] as const;
  const parts = rows.map(([type, size]) => chunk(type, images.get(size)!));
  const length = 8 + parts.reduce((sum, part) => sum + part.byteLength, 0);
  const header = Buffer.alloc(8);
  header.write("icns", 0, 4, "ascii");
  header.writeUInt32BE(length, 4);
  return Buffer.concat([header, ...parts], length);
}

function ico(images: Map<number, Uint8Array>, sizes: readonly number[]) {
  const header = Buffer.alloc(6 + sizes.length * 16);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(sizes.length, 4);
  let offset = header.byteLength;
  sizes.forEach((size, index) => {
    const data = images.get(size)!;
    const row = 6 + index * 16;
    header[row] = size === 256 ? 0 : size;
    header[row + 1] = size === 256 ? 0 : size;
    header.writeUInt16LE(1, row + 4);
    header.writeUInt16LE(32, row + 6);
    header.writeUInt32LE(data.byteLength, row + 8);
    header.writeUInt32LE(offset, row + 12);
    offset += data.byteLength;
  });
  return Buffer.concat([
    header,
    ...sizes.map((size) => Buffer.from(images.get(size)!)),
  ], offset);
}

async function render(source: Uint8Array, sizes: readonly number[]) {
  const rows = await Promise.all(sizes.map(async (size) => {
    const data = await sharp(source)
      .resize(size, size, { fit: "fill" })
      .png({ compressionLevel: 9 })
      .toBuffer();
    return [size, data] as const;
  }));
  return new Map<number, Uint8Array>(rows);
}

export async function buildIcon(
  source: string | undefined,
  platform: NodeJS.Platform = process.platform,
  root = join(homedir(), ".luon", "icons"),
) {
  if (!source) return source;
  const kind = iconKind(platform);
  if (!kind) return source;
  const input = new Uint8Array(await readFile(source));
  const hash = new Bun.CryptoHasher("sha256")
    .update("luon-icon-v2:")
    .update(kind)
    .update(input)
    .digest("hex");
  const file = join(root, `${hash}.${kind}`);
  if (await Bun.file(file).exists()) return file;
  const sizes = kind === "icns"
    ? [16, 32, 64, 128, 256, 512, 1024]
    : kind === "ico" ? [16, 24, 32, 48, 64, 128, 256] : [512];
  const images = await render(input, sizes);
  const data = kind === "icns"
    ? icns(images)
    : kind === "ico" ? ico(images, sizes) : images.get(512)!;
  await mkdir(root, { mode: 0o700, recursive: true });
  const temp = join(root, `.${hash}-${process.pid}.${kind}`);
  try {
    await writeFile(temp, data, { mode: 0o600 });
    await chmod(temp, 0o600);
    await rename(temp, file).catch(async (error) => {
      if (!await Bun.file(file).exists()) throw error;
    });
  } finally {
    await rm(temp, { force: true });
  }
  return file;
}
