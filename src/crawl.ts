import { homedir } from "node:os";
import { join } from "node:path";
import type { ViewOptions } from "@luon/webview";

export function crawlService(id: string): ViewOptions["browserService"] {
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(id)) {
    throw new Error("Invalid crawl host ID.");
  }
  return async host => {
    const { service } = await import("@luon/crawl/service");
    const root = join(homedir(), ".luon", "crawl", id);
    const folder = host.windowId ? join(root, "windows", host.windowId) : root;
    return service(folder, host);
  };
}
