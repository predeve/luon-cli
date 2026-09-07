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
  controlView,
  openView,
  type ViewOptions,
} from "@luon/webview";

import type { Args } from "./args.ts";
import { login, readAccount } from "./account.ts";
import { cliCommand } from "./relaunch.ts";
import { showNotice } from "./notice.ts";
import { iconSvg, type IconSource } from "@luon/runtime/favicon";
import {
  cliUpdate,
  requireCliVersion,
  serverState,
  showServerIssue,
  warnCliVersion,
} from "./launch-check.ts";

async function buildIcon(
  source: string | undefined,
  platform = process.platform,
  root?: string,
) {
  const icon = await import("./icon.ts");
  return icon.buildIcon(source, platform, root);
}

export type SiteManifest = {
  icons?: Record<string, string>;
  style?: Record<string, unknown>;
  id: string;
  source?: "site" | "template";
  title: string;
  url: string;
  window: Record<string, unknown>;
};

export function validSiteId(value: unknown): value is string {
  if (typeof value !== "string") return false;
  return /^(?:web|app)-[a-z0-9-]{1,64}$/.test(value);
}

function validTemplateId(value: unknown): value is string {
  return typeof value === "string"
    && /^tmp-[a-z0-9-]{1,64}$/.test(value);
}

function local(host: string) {
  return ["127.0.0.1", "localhost", "::1"].includes(host)
    || host.endsWith(".localhost");
}

function defaultIcon(id: string) {
  if (id.startsWith("app-") || id.startsWith("tmp-")) {
    return "lucide:app-window";
  }
  return "lucide:globe-2";
}

export function sendSiteAuth(
  account: { url: string } | undefined,
  url: URL,
) {
  return Boolean(account && (
    account.url === url.origin
    || /^(?:web|app|tmp)\.luon\.dev$/.test(url.hostname)
  ));
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

export function launchUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Luon App launch URL is invalid.");
  }
  if (url.protocol !== "luon:") {
    throw new Error("Luon App launch URL is invalid.");
  }
  if (url.hostname === "app" && url.pathname === "/check") {
    const callback = url.searchParams.get("callback");
    const target = url.searchParams.get("launch") || undefined;
    if (!callback) throw new Error("Luon CLI check callback is missing.");
    if (target && launchUrl(target).kind !== "open") {
      throw new Error("Luon CLI check launch target is invalid.");
    }
    return { callback, kind: "check", target } as const;
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("Luon App launch URL is invalid.");
  }
  const short = /^(web|app)\.(luon\.dev|localhost)$/
    .exec(url.hostname);
  const template = /^tmp\.(luon\.dev|localhost)$/
    .exec(url.hostname);
  const direct = /^((web|app)-([a-z0-9-]{1,64}))\.(luon\.dev|localhost)$/
    .exec(url.hostname);
  const path = /^\/([a-z0-9-]{1,64})\/?$/.exec(url.pathname);
  if (template && path) {
    const port = url.port ? `:${url.port}` : "";
    if (template[1] === "luon.dev" && url.port) {
      throw new Error("Luon App launch URL is invalid.");
    }
    const protocol = template[1] === "localhost" ? "http" : "https";
    return {
      kind: "open",
      manifest: `${protocol}://tmp.${template[1]}${port}`
        + `/${path[1]}/manifest`,
    } as const;
  }
  const kind = short?.[1] || direct?.[2];
  const id = short ? path?.[1] : direct?.[3];
  const base = short?.[2] || direct?.[4];
  const directPath = url.pathname === "" || url.pathname === "/";
  if (!id || !base || (!short && !directPath)
    || (base === "luon.dev" && url.port)) {
    throw new Error("Luon App launch URL is invalid.");
  }
  const port = url.port ? `:${url.port}` : "";
  const protocol = base === "localhost" ? "http" : "https";
  return {
    kind: "open",
    manifest: `${protocol}://${kind}.${base}${port}/${id}/manifest`,
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

async function imageSource(
  value: string,
  page: URL,
  headers: Record<string, string>,
) {
  const name = value.slice("image:".length);
  if (!name || name.includes("..") || name.startsWith("/")
    || !/^[a-z0-9_./-]+\.(?:jpe?g|png|svg|webp)$/i.test(name)) {
    throw new Error("App image icons must use a safe relative image path.");
  }
  const url = new URL(name, page);
  if (url.origin !== page.origin) {
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

export async function iconSource(
  value: unknown,
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
  if (spec.startsWith("image:")) {
    return imageSource(spec, page, headers);
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

async function cacheIcon(
  root: string,
  name: string,
  data: string | Uint8Array,
) {
  const file = join(root, name);
  await mkdir(root, { mode: 0o700, recursive: true });
  if (!await Bun.file(file).exists()) {
    await writeFile(file, data, { mode: 0o600 });
    await chmod(file, 0o600);
  }
  return file;
}

export async function systemIcon(
  source: IconSource | undefined,
  root: string,
) {
  if (!source) return;
  if (source.kind === "symbol") return `symbol:${source.value}`;
  if (source.kind === "lucide") {
    const data = await readFile(source.value);
    return cacheIcon(root, `${iconHash(data)}.svg`, data);
  }
  const data = source.data!;
  const ext = source.mime === "image/svg+xml" ? "svg"
    : source.mime === "image/png" ? "png"
      : source.mime === "image/webp" ? "webp" : "jpg";
  return cacheIcon(root, `${iconHash(data)}.${ext}`, data);
}

export async function dockIcon(
  source: IconSource | undefined,
  style: Record<string, unknown>,
  root: string,
) {
  if (source?.kind === "image" && source.mime === "image/svg+xml"
    && Buffer.from(source.data!).includes('data-luon-site-icon="1"')) {
    const data = source.data!;
    return cacheIcon(root, `${iconHash(data)}-dock.svg`, data);
  }
  const svg = await iconSvg(source, style);
  if (!svg) return;
  return cacheIcon(
    root,
    `${iconHash(svg)}-dock.svg`,
    svg,
  );
}

export function viewOptions(
  manifest: SiteManifest,
  url: URL,
  icon: string | undefined,
  statusIcon: string | undefined,
  icons?: ViewOptions["icons"],
): ViewOptions {
  const win = record(manifest.window);
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
    id: manifest.id,
    icon,
    icons,
    maxHeight: number(win.maxHeight),
    maxWidth: number(win.maxWidth),
    minHeight: number(win.minHeight),
    minWidth: number(win.minWidth),
    mode: choice(win.mode, ["both", "dock", "system"]),
    native: bool(win.native),
    remember: choice(win.remember, ["all", "none", "position", "size"]),
    rememberId: manifest.id,
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

export async function openApp(value: string): Promise<void> {
  const launch = launchUrl(value);
  if (launch.kind === "check") {
    await confirmCheck(launch.callback);
    return launch.target ? openApp(launch.target) : undefined;
  }
  const updateTask = cliUpdate();
  const target = await manifestUrl(launch.manifest);
  const template = target.url.hostname.startsWith("tmp.");
  const headers: Record<string, string> = {};
  if (target.account && sendSiteAuth(target.account, target.url)) {
    headers.authorization = `Bearer ${target.account.token}`;
  }
  let response: Response;
  try {
    response = await fetch(target.url, {
      headers,
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    if (template) throw error;
    await showServerIssue("Luon App", "unavailable");
    return;
  }
  if (response.status === 401 || response.status === 403) {
    try {
      const account = await login();
      if (!sendSiteAuth(account, target.url)) {
        throw new Error("The connected account does not match this Core.");
      }
      response = await fetch(target.url, {
        headers: { authorization: `Bearer ${account.token}` },
        signal: AbortSignal.timeout(10_000),
      });
    } catch (error) {
      await showNotice({
        message: error instanceof Error ? error.message
          : "Luon CLI login could not be completed.",
        title: "Sign in required",
        tone: "warning",
      });
      return;
    }
  }
  if (!response.ok) {
    if (!template && response.status === 404) {
      await showServerIssue("Luon App", "missing");
      return;
    }
    if (!template && response.status >= 500) {
      await showServerIssue("Luon App", "unavailable");
      return;
    }
    throw new Error(`Luon App manifest request failed (${response.status}).`);
  }
  const body = await response.json() as Partial<SiteManifest>;
  if (typeof body.id !== "string"
    || !(body.source === "site" && validSiteId(body.id)
      || body.source === "template" && validTemplateId(body.id))
    || typeof body.title !== "string" || body.title.length > 120
    || typeof body.url !== "string") {
    throw new Error("Luon App manifest is invalid.");
  }
  const page = new URL(body.url, target.url);
  const manifest: SiteManifest = {
    icons: iconSpecs(body.icons),
    style: record(body.style),
    id: body.id,
    title: body.title,
    url: body.url,
    window: record(body.window),
  };
  if (page.username || page.password
    || (page.protocol !== "https:" && !(page.protocol === "http:"
      && local(page.hostname)))) {
    throw new Error("Luon App Site URL is not secure.");
  }
  const stateTask = body.source === "site"
    ? serverState(page.toString())
    : Promise.resolve("ready" as const);
  const [update, state] = await Promise.all([updateTask, stateTask]);
  if (!await requireCliVersion(manifest.title, update)) return;
  if (state !== "ready") {
    await showServerIssue(manifest.title, state);
    return;
  }
  const options = viewOptions(manifest, page, undefined, undefined);
  const assetHeaders: Record<string, string> = {};
  const assets = join(homedir(), ".luon", "apps", manifest.id, "assets");
  const win = record(manifest.window);
  const publicIcon = await imageSource(
    "image:favicon.svg",
    page,
    assetHeaders,
  ).catch(() => undefined);
  const appIcon = publicIcon
    || await iconSource(defaultIcon(manifest.id), page, assetHeaders);
  const statusSource = win.systemIcon
    ? await iconSource(win.systemIcon, page, assetHeaders)
    : appIcon;
  const [icon, statusIcon] = await Promise.all([
    dockIcon(appIcon, record(manifest.style), assets).then((source) => (
      buildIcon(source, process.platform, assets)
    )),
    systemIcon(statusSource, assets),
  ]);
  const iconRows = await Promise.all(
    Object.entries(manifest.icons || {}).map(async ([name, spec]) => {
      const source = await iconSource(spec, page, assetHeaders);
      const [dock, system] = await Promise.all([
        dockIcon(source, record(manifest.style), assets).then((icon) => (
          buildIcon(icon, process.platform, assets)
        )),
        systemIcon(source, assets),
      ]);
      return [name, { icon: dock, systemIcon: system }] as const;
    }),
  );
  const icons = Object.fromEntries(iconRows);
  const child = await openView(
    { ...viewOptions(manifest, page, icon, statusIcon, icons),
      relaunch: process.platform === "darwin"
        ? cliCommand(["app", "open", value]) : undefined },
  );
  if (process.platform === "darwin") {
    void Bun.sleep(300).then(() => {
      try {
        controlView(child.pid, "show");
      } catch {
        // The user may close a short-lived App before focus is reapplied.
      }
    });
  }
  console.log(`Luon App: running · PID ${child.pid}`);
  void warnCliVersion(update);
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
    if (args.appUrl.toLowerCase().endsWith(".luon")
      || args.appUrl.startsWith("file:")) {
      const { runLuonFile } = await import("./luon-file.ts");
      return runLuonFile({
        ...args,
        command: "file",
        root: args.appUrl,
        view: "webview",
      });
    }
    return openApp(args.appUrl);
  }
  throw new Error("Use luon app install before opening an App Preview.");
}
