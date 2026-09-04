import { installedVersions } from "./version.ts";
import { showNotice, showToast } from "./notice.ts";

export type ServerState = "missing" | "ready" | "stopped" | "unavailable";

type Fetcher = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

const registry = "https://pkg.luon.dev";
const semver = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

export async function serverState(
  value: string,
  request: Fetcher = fetch,
): Promise<ServerState> {
  try {
    const url = new URL("/_luon/status", value);
    const response = await request(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(45_000),
    });
    const body = await response.json().catch(() => ({})) as {
      state?: unknown;
    };
    if (response.ok && body.state === "ready") return "ready";
    if (response.status === 404 || body.state === "missing") return "missing";
    if (response.status === 409 || body.state === "stopped") return "stopped";
    return "unavailable";
  } catch {
    return "unavailable";
  }
}

export async function requireServer(title: string, url: string) {
  const state = await serverState(url);
  if (state === "ready") return true;
  await showServerIssue(title, state);
  return false;
}

export async function showServerIssue(
  title: string,
  state: Exclude<ServerState, "ready">,
) {
  const message = state === "missing"
    ? "This Site no longer exists on the server."
    : state === "stopped"
      ? "This Site has not been started on the server."
      : "Luon could not communicate with this Site's server.";
  await showNotice({
    message: `${message}\n\nThe app was not opened.`,
    title: `${title} cannot start`,
    tone: "error",
  });
}

export async function latestCli(
  current: string,
  request: Fetcher = fetch,
) {
  try {
    const response = await request(
      `${registry}/${encodeURIComponent("@luon/cli")}`,
      { signal: AbortSignal.timeout(4_000) },
    );
    if (!response.ok) return;
    const body = await response.json() as {
      "dist-tags"?: { latest?: unknown };
    };
    const latest = body["dist-tags"]?.latest;
    if (typeof latest !== "string" || !semver.test(latest)
      || Bun.semver.order(latest, current) <= 0) return;
    return latest;
  } catch {
    return;
  }
}

export async function warnCliVersion() {
  const current = await installedVersions().then(
    (value) => value.cli,
    () => undefined,
  );
  if (!current) return;
  const latest = await latestCli(current);
  if (!latest) return;
  await showToast({
    message: `${current} → ${latest}\nRun luon update when convenient.`,
    title: "Luon CLI update available",
    tone: "warning",
  });
}

export async function showInvalidPackage(title: string) {
  await showNotice({
    message: "The .luon package could not be verified. It may be damaged or "
      + "modified, so Luon did not run it.",
    title: `${title} cannot start`,
    tone: "error",
  });
}
