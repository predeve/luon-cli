import { afterEach, expect, test } from "bun:test";
import { basename, resolve } from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";

import { exportSite } from "../src/export.ts";

const roots: string[] = [];
const account = {
  token: `luon_${"a".repeat(43)}`,
  url: "https://core.luon.dev",
  version: 1 as const,
};

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => (
    rm(root, { force: true, recursive: true })
  )));
});

test("exports a remote Site with its build filename", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "luon-cli-export-"));
  roots.push(root);
  let request: Request | undefined;
  const path = await exportSite("app-product", {
    account,
    root,
    send: async (input, init) => {
      request = new Request(input, init);
      return new Response("portable", { headers: {
        "content-type": "application/vnd.luon",
        "x-luon-built-at": "2026-09-04T00:49:26.000Z",
        "x-luon-site-title": encodeURIComponent("My/App"),
      } });
    },
  });
  expect(request?.url).toBe(
    "https://core.luon.dev/api/sites/app-product/export",
  );
  expect(request?.headers.get("authorization")).toBe(
    `Bearer ${account.token}`,
  );
  expect(basename(path)).toMatch(/^\d{14}_My-App\.luon$/);
  expect(await Bun.file(path).text()).toBe("portable");
});

test("requires login and forwards export errors", async () => {
  await expect(exportSite("app-product", { account: null }))
    .rejects.toThrow("luon login");
  await expect(exportSite("app-product", {
    account,
    send: async () => Response.json({
      message: "The Site could not be exported.",
    }, { status: 403 }),
  })).rejects.toThrow("could not be exported");
});
