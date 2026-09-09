import { createHash } from "node:crypto";
import { viewArgs } from "@luon/webview";
import type { LuonFile } from "@luon/runtime/luon-file";
import { dockIcon, iconSource, systemIcon, viewOptions } from "./app.ts";
import { buildIcon } from "./icon.ts";
import { siteFiles, staticServer } from "./luon-file.ts";
import { findPort } from "@luon/network";

function number(value: number, size: 4 | 8) {
  const data = Buffer.alloc(size);
  if (size === 4) data.writeUInt32LE(value);
  else data.writeBigUInt64LE(BigInt(value));
  return data;
}

function text(value: string) {
  const data = Buffer.from(value);
  return Buffer.concat([number(data.length, 4), data]);
}

export function serverPage(url: string) {
  const target = JSON.stringify(new URL(url).href).replaceAll("<", "\\u003c");
  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="referrer" content="no-referrer">
<title>Connecting…</title></head><body>
<p>Connecting to the app server. Internet access is required.</p>
<script>window.location.replace(${target});</script></body></html>`;
}

export async function optimizeAsset(
  name: string, file: Blob,
): Promise<Uint8Array<ArrayBuffer>> {
  const bytes = await file.bytes();
  if (!name.endsWith(".png") || bytes.length > 16 * 1024 * 1024) return bytes;
  try {
    const { default: sharp } = await import("sharp");
    const source = sharp(bytes);
    const info = await source.metadata();
    if ((info.pages || 1) > 1 || info.depth !== "uchar"
      || (info.width || 0) * (info.height || 0) > 4_000_000) return bytes;
    const next = await source.keepMetadata().png({ compressionLevel: 9 }).toBuffer();
    if (next.length >= bytes.length) return bytes;
    const before = await sharp(bytes).ensureAlpha().raw().toBuffer();
    const after = await sharp(next).ensureAlpha().raw().toBuffer();
    return before.equals(after) ? next as Uint8Array<ArrayBuffer> : bytes;
  } catch {
    return bytes;
  }
}

export async function staticPayload(
  pkg: LuonFile,
  icon: string | undefined,
  icons: Array<[string, string]>,
  base = 0,
  platform: NodeJS.Platform = process.platform,
  root?: string,
) {
  const remote = pkg.manifest.data === "server";
  const assets = new Map<string, Uint8Array<ArrayBuffer>>();
  for (const [name, file] of pkg.files) {
    if (!name.startsWith("site/") || name.endsWith(".map")) continue;
    assets.set(`/${name.slice(5)}`, await optimizeAsset(name, file));
  }
  if (remote) {
    assets.set("/index.html", new TextEncoder().encode(
      serverPage(pkg.manifest.url!),
    ));
  }
  if (!assets.has("/index.html")) throw new Error("Static app HTML is missing.");
  const iconName = icon ? `icon.${icon.split(".").at(-1)}` : "";
  if (icon) assets.set(`/__luon/${iconName}`, await Bun.file(icon).bytes());
  const specs = new Map<string, string>();
  const docks = new Map<string, string | undefined>();
  for (const [index, [spec, path]] of icons.entries()) {
    const name = `state-${index}.svg`;
    assets.set(`/__luon/${name}`, await Bun.file(path).bytes());
    specs.set(spec, `$LUON_ASSETS/${name}`);
  }
  const favicon = assets.get("/favicon.svg");
  if (favicon) assets.set("/__luon/favicon.svg", favicon);
  const win = pkg.manifest.app?.window || {};
  const values = [...new Set([
    ...Object.values(pkg.manifest.app?.icons || {}), win.systemIcon,
  ].filter((spec): spec is string => typeof spec === "string"))];
  if (values.length && root) {
    const server = remote
      ? undefined : staticServer(siteFiles(pkg), await findPort());
    try {
      const page = new URL(remote
        ? pkg.manifest.url! : `http://localhost:${server!.port}/`);
      for (const [index, spec] of values.entries()) {
        const source = await iconSource(spec, page, {});
        const status = await systemIcon(source, root);
        const dock = await buildIcon(await dockIcon(
          source, pkg.manifest.favicon?.style || {}, root,
        ), platform, root);
        for (const [kind, path] of [["system", status], ["dock", dock]]) {
          if (!path) continue;
          let ref = path;
          if (!path.startsWith("symbol:")) {
            const name = `${kind}-${index}.${path.split(".").at(-1)}`;
            assets.set(`/__luon/${name}`, await Bun.file(path).bytes());
            ref = `$LUON_ASSETS/${name}`;
          }
          if (kind === "system") specs.set(spec, ref);
          else docks.set(spec, ref);
        }
      }
    } finally {
      server?.stop(true);
    }
  }
  const system = typeof win.systemIcon === "string"
    ? specs.get(win.systemIcon) || (win.systemIcon.startsWith("symbol:")
      ? win.systemIcon : undefined) : undefined;
  const stateIcons = Object.fromEntries(
    Object.entries(pkg.manifest.app?.icons || {}).map(([name, spec]) => [
      name, { icon: docks.get(spec), systemIcon: specs.get(spec) },
    ]),
  );
  const url = new URL("http://127.0.0.1:6100/");
  const options = viewOptions({
    id: pkg.manifest.id, title: pkg.manifest.title,
    url: url.href, window: { ...win, close: win.close || "quit" },
  }, url, icon ? `$LUON_ASSETS/${iconName}` : undefined,
  system || (favicon ? "$LUON_ASSETS/favicon.svg" : undefined), stateIcons);
  // Resolve ~ and relative storage paths on the machine running the app.
  if (options.mcp) {
    throw Error("MCP needs the Bun app host. Export a .luon file or use the "
      + "standard executable, not standalone native mode.");
  }
  const args = viewArgs(options, true);
  const urlIndex = args.indexOf("--url");
  if (urlIndex >= 0) args.splice(urlIndex, 2);
  args.push("--window-file", "$LUON_ASSETS/window.json");
  const rows: Array<{
    name: string; offset: number; data: Uint8Array<ArrayBuffer>;
  }> = [];
  const blocks: Uint8Array<ArrayBuffer>[] = [];
  const hashes = new Map<string, number>();
  let offset = 0;
  for (const [name, data] of assets) {
    const hash = createHash("sha256").update(data).digest("hex");
    let at = hashes.get(hash);
    if (at === undefined) {
      at = offset;
      hashes.set(hash, at);
      blocks.push(data);
      offset += data.length;
    }
    rows.push({ name, offset: at, data });
  }
  const prefix = Buffer.concat([
    text(pkg.manifest.id), number(args.length, 4), ...args.map(text),
    number(rows.length, 4),
  ]);
  const tableSize = rows.reduce((size, row) => (
    size + Buffer.byteLength(row.name) + 20
  ), prefix.length);
  const table = rows.flatMap((row) => [
    text(row.name), number(tableSize + row.offset, 8), number(row.data.length, 8),
  ]);
  const size = tableSize + offset;
  if (size > 512 * 1024 * 1024) throw new Error("Static app exceeds 512 MiB.");
  return new Blob([
    prefix, ...table, ...blocks,
    Buffer.from("LUONAPP1"), number(base, 8), number(size, 8),
  ]);
}
