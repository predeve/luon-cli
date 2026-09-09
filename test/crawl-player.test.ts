import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { packageRoot, writeLuon, type LuonFile } from "@luon/runtime/luon-file";
import { buildStandalone } from "../src/standalone";
import { template } from "../../crawl/src/template";

test.skipIf(process.platform !== "darwin" || process.arch !== "arm64")(
  "compiled static browser includes its script worker and native formatter",
  async () => {
    // Converter builds outside the workspace, without ancestor node_modules.
    const root = await mkdtemp(join(tmpdir(), "luon-crawl-player-"));
    let child: Bun.Subprocess | undefined;
    let data = "";
    try {
      const pkg = { manifest: {
        format: 1, createdAt: new Date().toISOString(),
        id: `app-${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`,
        name: "check", title: "Check", type: "app",
        runtime: "0.1.87", version: "test", mode: "static", data: "local",
        database: false, app: { window: { native: true, browserControl: true,
          storage: { rootDir: join(root, "storage") } } },
        features: { database: false, cache: false, pglite: false,
          excel: false, zip: false },
      }, files: new Map([["site/index.html", new File(["<h1>Check</h1>"],
        "index.html")]]) } as LuonFile;
      const input = join(root, "check.luon");
      await Bun.write(input, await writeLuon(pkg));
      const output = await buildStandalone({ command: "app", appAction: "build",
        root: input, output: join(root, "Check.app"), open: false, yes: false,
        preference: "optimize", target: "macos-arm" });
      const source = `
        import { createRequire } from "node:module";
        const binding = createRequire(process.env.LUON_FORMAT_BINDING)(
          process.env.LUON_FORMAT_BINDING);
        const value = await binding.format("check.ts", "const x=1",
          {embeddedLanguageFormatting: "off", sortTailwindcss: false},
          async()=>null, async()=>null, async()=>null, async()=>null);
        if (value.errors.length || !value.code.includes("const x = 1")) {
          throw Error("Embedded formatter failed.");
        }
        ${template("a1b2c3d4e5f6")}
      `;
      let reply: any;
      child = Bun.spawn([join(output, "Contents/MacOS/Luon Player"),
        "--luon-crawl-worker"], {
        stdout: "ignore", stderr: "pipe",
        ipc(value, proc) {
          if (value.type === "ready") proc.send({ type: "start", run: 1,
            inspect: true, source });
          if (value.type === "meta" || value.type === "error") {
            reply = value;
            proc.kill();
          }
        },
      });
      const timer = setTimeout(() => child?.kill(), 15000);
      try { await child.exited; } finally { clearTimeout(timer); }
      const error = await new Response(child.stderr).text();
      expect({ reply: reply?.type, error }).toEqual({ reply: "meta", error: "" });
      expect(reply.value.id).toBe("a1b2c3d4e5f6");
      data = packageRoot(pkg.manifest);
      child = Bun.spawn([join(output, "Contents/MacOS/Luon Player"),
        "--luon-headless"], { stdout: "pipe", stderr: "pipe" });
      const timeout = setTimeout(() => child?.kill(), 10000);
      try {
        const reader = child.stdout.getReader();
        const line = await reader.read();
        const url = new TextDecoder().decode(line.value).trim();
        expect(await (await fetch(url)).text()).toBe("<h1>Check</h1>");
        child.kill();
        await child.exited;
        expect(await new Response(child.stderr).text()).toBe("");
      } finally { clearTimeout(timeout); }
    } finally {
      child?.kill();
      await rm(root, { recursive: true, force: true });
      if (data) await rm(data, { recursive: true, force: true });
    }
  }, 30000,
);
