import {
  access,
  chmod,
  constants,
  mkdir,
  readFile,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  controlViewId,
  openView,
  type ViewOptions,
} from "@luon/webview";

import type { Args } from "./args.ts";
import { readAccount } from "./account.ts";

type AppManifest = {
  icon?: string;
  icons?: Record<string, string>;
  iconStyle?: Record<string, unknown>;
  id: string;
  source?: "site" | "template";
  title: string;
  url: string;
  window: Record<string, unknown>;
};

function local(host: string) {
  return ["127.0.0.1", "localhost", "::1"].includes(host)
    || host.endsWith(".localhost");
}

async function manifestUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Luon App manifest URL is invalid.");
  }
  if (url.username || url.password
    || (url.protocol !== "https:" && !(url.protocol === "http:"
      && local(url.hostname)))) {
    throw new Error("Luon App manifest URL is not secure.");
  }
  const account = await readAccount();
  const official = url.hostname === "luon.dev"
    || url.hostname.endsWith(".luon.dev");
  if (!official && !local(url.hostname) && account?.url !== url.origin) {
    throw new Error("Luon App manifest is not from the connected Core.");
  }
  return { account, url };
}

function launchUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Luon App launch URL is invalid.");
  }
  if (url.protocol !== "luon:" || url.hostname !== "app") {
    throw new Error("Luon App launch URL is invalid.");
  }
  if (url.pathname === "/check") {
    const callback = url.searchParams.get("callback");
    if (!callback) throw new Error("Luon CLI check callback is missing.");
    return { callback, kind: "check" } as const;
  }
  if (url.pathname !== "/preview") {
    throw new Error("Luon App launch URL is invalid.");
  }
  const manifest = url.searchParams.get("manifest");
  if (!manifest) throw new Error("Luon App manifest is missing.");
  return {
    action: url.searchParams.get("action") === "close" ? "close" : "open",
    kind: "preview",
    manifest,
  } as const;
}

async function confirmCheck(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Luon CLI check callback is invalid.");
  }
  const account = await readAccount();
  const official = url.hostname === "luon.dev"
    || url.hostname.endsWith(".luon.dev");
  if (url.username || url.password
    || !/^\/api\/cli\/check\/[A-Za-z0-9_-]{43}$/.test(url.pathname)
    || (url.protocol !== "https:" && !(url.protocol === "http:"
      && local(url.hostname)))
    || (!official && !local(url.hostname) && account?.url !== url.origin)) {
    throw new Error("Luon CLI check callback is not trusted.");
  }
  const response = await fetch(url, {
    method: "POST",
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) {
    throw new Error(`Luon CLI check failed (${response.status}).`);
  }
  console.log("Luon CLI: installed");
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function bool(value: unknown) {
  return typeof value === "boolean" ? value : undefined;
}

function number(value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function text(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

function choice<T extends string>(value: unknown, values: readonly T[]) {
  return typeof value === "string" && values.includes(value as T)
    ? value as T
    : undefined;
}

function systemMenu(value: unknown) {
  if (!Array.isArray(value)) return;
  const allowed = ["mode", "quit"] as const;
  const items = value.filter((item): item is typeof allowed[number] => (
    typeof item === "string" && allowed.includes(item as typeof allowed[number])
  ));
  return items.length === value.length ? items : undefined;
}

type IconSource = {
  data?: Uint8Array;
  kind: "emoji" | "image" | "lucide" | "symbol";
  mime?: string;
  value: string;
};

function iconName(value: string) {
  return /^[a-z][a-z0-9-]{0,63}$/.test(value);
}

function iconSpecs(value: unknown) {
  const source = record(value);
  const entries = Object.entries(source);
  if (entries.length > 32) {
    throw new Error("An App can register up to 32 icons.");
  }
  const result: Record<string, string> = {};
  for (const [name, spec] of entries) {
    if (name === "default" || !/^[a-z][a-z0-9-]{0,31}$/.test(name)
      || typeof spec !== "string") {
      throw new Error(`App icon entry is invalid: ${name}`);
    }
    result[name] = spec;
  }
  return result;
}

function iconColor(value: unknown, fallback: string) {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value)
    ? value
    : fallback;
}

function iconSize(value: unknown) {
  return typeof value === "number" && Number.isInteger(value)
    && value >= 32 && value <= 84 ? value : 56;
}

function escapeXml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

async function imageSource(
  value: string,
  manifest: AppManifest,
  page: URL,
  headers: Record<string, string>,
) {
  const name = value.slice("image:".length);
  if (!name || name.includes("..") || name.startsWith("/")
    || !/^[a-z0-9_./-]+\.(?:jpe?g|png|svg|webp)$/i.test(name)) {
    throw new Error("App image icons must use a safe relative image path.");
  }
  const url = new URL(name, page);
  const prefix = `/api/templates/${manifest.id}/preview/`;
  if (url.origin !== page.origin || (manifest.source !== "site"
    && !url.pathname.startsWith(prefix))) {
    throw new Error("App image icon is outside the App.");
  }
  const response = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    throw new Error(`App image icon request failed (${response.status}).`);
  }
  const length = Number(response.headers.get("content-length") || 0);
  if (length > 1024 * 1024) throw new Error("App image icon is too large.");
  const data = new Uint8Array(await response.arrayBuffer());
  if (data.byteLength > 1024 * 1024) {
    throw new Error("App image icon is too large.");
  }
  const mime = (response.headers.get("content-type") || "")
    .split(";", 1)[0]!.trim().toLowerCase();
  if (!["image/jpeg", "image/png", "image/svg+xml", "image/webp"]
    .includes(mime)) {
    throw new Error("App image icon must be SVG, PNG, JPEG, or WebP.");
  }
  return { data, kind: "image", mime, value: url.toString() } as IconSource;
}

async function iconSource(
  value: unknown,
  manifest: AppManifest,
  page: URL,
  headers: Record<string, string>,
): Promise<IconSource | undefined> {
  if (typeof value !== "string" || !value.trim()) return;
  const spec = value.trim();
  if (spec.startsWith("lucide:")) {
    const name = spec.slice("lucide:".length);
    if (!iconName(name)) throw new Error("Lucide icon name is invalid.");
    const file = fileURLToPath(
      import.meta.resolve(`lucide-static/icons/${name}.svg`),
    );
    if (!await Bun.file(file).exists()) {
      throw new Error(`Lucide icon was not found: ${name}`);
    }
    return { kind: "lucide", value: file };
  }
  if (spec.startsWith("emoji:")) {
    const emoji = spec.slice("emoji:".length).trim();
    if (!emoji || [...emoji].length > 12 || /[\u0000-\u001f]/.test(emoji)) {
      throw new Error("Emoji icon is invalid.");
    }
    return { kind: "emoji", value: emoji };
  }
  if (spec.startsWith("image:")) {
    return imageSource(spec, manifest, page, headers);
  }
  const symbol = spec.startsWith("symbol:")
    ? spec.slice("symbol:".length)
    : spec;
  if (!/^[a-z][a-z0-9.-]{0,63}$/.test(symbol)) {
    throw new Error("System symbol name is invalid.");
  }
  return { kind: "symbol", value: symbol };
}

function iconHash(value: string | Uint8Array) {
  return new Bun.CryptoHasher("sha256").update(value).digest("hex");
}

async function cacheIcon(name: string, data: string | Uint8Array) {
  const root = join(homedir(), ".luon", "icons");
  const file = join(root, name);
  await mkdir(root, { mode: 0o700, recursive: true });
  if (!await Bun.file(file).exists()) {
    await writeFile(file, data, { mode: 0o600 });
    await chmod(file, 0o600);
  }
  return file;
}

async function systemIcon(source: IconSource | undefined) {
  if (!source) return;
  if (source.kind === "symbol") return `symbol:${source.value}`;
  if (source.kind === "emoji") return `emoji:${source.value}`;
  if (source.kind === "lucide") return source.value;
  const data = source.data!;
  const ext = source.mime === "image/svg+xml" ? "svg"
    : source.mime === "image/png" ? "png"
      : source.mime === "image/webp" ? "webp" : "jpg";
  return cacheIcon(`${iconHash(data)}.${ext}`, data);
}

async function dockIcon(
  source: IconSource | undefined,
  style: Record<string, unknown>,
) {
  if (!source || source.kind === "symbol") return;
  const from = iconColor(style.from, "#7c3aed");
  const to = iconColor(style.to, "#2563eb");
  const foreground = iconColor(style.foreground, "#ffffff");
  const size = iconSize(style.size);
  const pixels = Math.round(1024 * size / 100);
  const offset = Math.round((1024 - pixels) / 2);
  let content = "";
  let identity = `${source.kind}:${source.value}`;
  if (source.kind === "lucide") {
    const raw = await readFile(source.value, "utf8");
    const body = raw.replace(/^[\s\S]*?<svg[^>]*>/, "")
      .replace(/<\/svg>\s*$/, "")
      .replaceAll("currentColor", foreground);
    const scale = pixels / 24;
    content = `<g transform="translate(${offset} ${offset}) scale(${scale})">${body}</g>`;
    identity += raw;
  } else if (source.kind === "emoji") {
    content = `<text x="512" y="${Math.round(512 + pixels * .28)}" `
      + `text-anchor="middle" font-size="${Math.round(pixels * .78)}" `
      + `font-family="Apple Color Emoji">${escapeXml(source.value)}</text>`;
  } else {
    const encoded = Buffer.from(source.data!).toString("base64");
    content = `<image x="${offset}" y="${offset}" width="${pixels}" `
      + `height="${pixels}" preserveAspectRatio="xMidYMid meet" `
      + `href="data:${source.mime};base64,${encoded}"/>`;
    identity += iconHash(source.data!);
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">
<defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
<stop stop-color="${from}"/><stop offset="1" stop-color="${to}"/>
</linearGradient></defs>
<rect x="32" y="32" width="960" height="960" rx="220" fill="url(#bg)"/>
${content}
</svg>\n`;
  return cacheIcon(
    `${iconHash(`${identity}:${from}:${to}:${foreground}:${size}`)}-dock.svg`,
    svg,
  );
}

function viewOptions(
  manifest: AppManifest,
  url: URL,
  icon: string | undefined,
  statusIcon: string | undefined,
  icons?: ViewOptions["icons"],
): ViewOptions {
  const win = record(manifest.window);
  const version = (url.searchParams.get("v") || "current")
    .toLowerCase()
    .replaceAll(/[^a-z0-9-]/g, "")
    .slice(-12) || "current";
  return {
    alwaysOnTop: bool(win.alwaysOnTop),
    background: text(win.background),
    center: bool(win.center),
    close: "quit",
    dragArea: choice(win.dragArea, ["content", "top"]),
    dragHeight: number(win.dragHeight),
    draggable: bool(win.draggable),
    focus: true,
    height: number(win.height),
    id: manifest.source === "site"
      ? `app-${manifest.id.slice(-12)}`
      : `preview-${manifest.id.slice(-12)}-${version}`,
    icon,
    icons,
    maxHeight: number(win.maxHeight),
    maxWidth: number(win.maxWidth),
    minHeight: number(win.minHeight),
    minWidth: number(win.minWidth),
    mode: choice(win.mode, ["both", "dock", "system"]),
    remember: choice(win.remember, ["all", "none", "position", "size"]),
    rememberId: manifest.source === "site"
      ? `app-${manifest.id.slice(-12)}`
      : `preview-${manifest.id.slice(-12)}`,
    resizable: bool(win.resizable),
    shadow: bool(win.shadow),
    state: choice(win.state, ["fullscreen", "maximized", "normal"]),
    systemIcon: statusIcon,
    systemIconSize: number(win.systemIconSize),
    systemMenu: systemMenu(win.systemMenu),
    title: manifest.title,
    titlebar: choice(win.titlebar, ["hidden", "system"]),
    transparent: bool(win.transparent),
    url: url.toString(),
    width: number(win.width),
    x: number(win.x),
    y: number(win.y),
  };
}

export async function openApp(value: string) {
  const launch = launchUrl(value);
  if (launch.kind === "check") return confirmCheck(launch.callback);
  const target = await manifestUrl(launch.manifest);
  const headers: Record<string, string> = {};
  if (target.account?.url === target.url.origin) {
    headers.authorization = `Bearer ${target.account.token}`;
  }
  const response = await fetch(target.url, {
    headers,
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    throw new Error(`Luon App manifest request failed (${response.status}).`);
  }
  const body = await response.json() as Partial<AppManifest>;
  if (!body.id || !/^(?:tmp|web)-[a-z0-9-]{1,64}$/.test(body.id)
    || typeof body.title !== "string" || body.title.length > 120
    || typeof body.url !== "string") {
    throw new Error("Luon App manifest is invalid.");
  }
  const page = new URL(body.url, target.url);
  const manifest: AppManifest = {
    icon: text(body.icon),
    icons: iconSpecs(body.icons),
    iconStyle: record(body.iconStyle),
    id: body.id,
    source: body.source === "site" ? "site" : "template",
    title: body.title,
    url: body.url,
    window: record(body.window),
  };
  if (manifest.source === "template" && (page.origin !== target.url.origin
    || !page.pathname.startsWith(`/api/templates/${body.id}/preview/`))) {
    throw new Error("Luon App Preview URL is invalid.");
  }
  if (manifest.source === "site" && (page.username || page.password
    || (page.protocol !== "https:" && !(page.protocol === "http:"
      && local(page.hostname))))) {
    throw new Error("Luon App Site URL is not secure.");
  }
  const options = viewOptions(manifest, page, undefined, undefined);
  if (launch.action === "close") {
    const closed = await controlViewId(options.id!, "close");
    console.log(`Luon App: ${closed ? "closed" : "not running"}`);
    return;
  }
  const assetHeaders = manifest.source === "site" ? {} : headers;
  const win = record(manifest.window);
  const appIcon = await iconSource(manifest.icon, manifest, page, assetHeaders);
  const statusSource = await iconSource(
    win.systemIcon ?? manifest.icon,
    manifest,
    page,
    assetHeaders,
  );
  const [icon, statusIcon] = await Promise.all([
    dockIcon(appIcon, record(manifest.iconStyle)),
    systemIcon(statusSource),
  ]);
  const iconRows = await Promise.all(
    Object.entries(manifest.icons || {}).map(async ([name, spec]) => {
      const source = await iconSource(spec, manifest, page, assetHeaders);
      const [dock, system] = await Promise.all([
        dockIcon(source, record(manifest.iconStyle)),
        systemIcon(source),
      ]);
      return [name, { icon: dock, systemIcon: system }] as const;
    }),
  );
  const icons = Object.fromEntries(iconRows);
  const child = await openView(
    viewOptions(manifest, page, icon, statusIcon, icons),
  );
  console.log(`Luon App: running · PID ${child.pid}`);
  const error = child.stderr
    ? new Response(child.stderr).text()
    : Promise.resolve("");
  const code = await child.exited;
  if (code !== 0) {
    throw new Error((await error).trim() || `Luon App exited with code ${code}.`);
  }
}

export async function runApp(args: Args) {
  if (args.appAction === "check") {
    const { viewBin } = await import("@luon/webview");
    const bin = viewBin();
    await access(bin, constants.X_OK).catch(() => {
      throw new Error(`Luon WebView executable is missing: ${bin}`);
    });
    console.log(`Luon WebView: ready · ${process.platform}/${process.arch}`);
    return;
  }
  if (args.appAction === "install") {
    await runApp({ ...args, appAction: "check" });
    const { installLauncher } = await import("@luon/agent");
    const value = await installLauncher();
    const { registerDevice } = await import("./device.ts");
    const registered = await registerDevice().catch((error) => {
      console.warn(error instanceof Error ? error.message : String(error));
      return false;
    });
    console.log(`Luon App: installed · ${value.app}`);
    console.log(`Luon device: ${registered ? "registered" : "sign in to register"}`);
    return;
  }
  if (args.appAction === "open" && args.appUrl) {
    return openApp(args.appUrl);
  }
  throw new Error("Use luon app install before opening an App Preview.");
}
