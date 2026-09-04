import { afterAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { prepareIcon } from "../src/project-icon.ts";

const root = await mkdtemp(join(tmpdir(), "luon-project-icon-"));

afterAll(async () => {
  await rm(root, { force: true, recursive: true });
});

describe("CLI project icon", () => {
  test("writes the configured icon to public", async () => {
    const app = join(root, "configured");
    await mkdir(join(app, ".config"), { recursive: true });
    await Bun.write(join(app, ".config", "template.json"), JSON.stringify({
      category: "app",
    }));
    await Bun.write(join(app, "package.json"), JSON.stringify({
      favicon: {
        autoGenerate: true,
        source: "lucide:message-circle",
        style: {
          from: "#db739d",
          to: "#454267",
        },
      },
    }));
    await mkdir(join(app, "app", "public"), { recursive: true });
    const oldIcon = join(app, "app", "public", "app-icon.svg");
    const oldFavicon = join(app, "app", "public", "favicon.svg");
    await Bun.write(oldIcon, "old icon");
    await Bun.write(oldFavicon, '<svg data-luon-app-icon="1"/>');
    const file = await prepareIcon(app);
    expect(file).toBe(join(app, "public", "favicon.svg"));
    expect(await Bun.file(oldIcon).exists()).toBe(false);
    expect(await Bun.file(oldFavicon).exists()).toBe(false);
    const svg = await Bun.file(file!).text();
    expect(svg).toContain('viewBox="0 0 1024 1024"');
    expect(svg).toContain('data-luon-site-icon="1"');
    const modified = (await stat(file!)).mtimeMs;
    await Bun.sleep(10);
    expect(await prepareIcon(app)).toBe(file);
    expect((await stat(file!)).mtimeMs).toBe(modified);

    await Bun.write(join(app, "package.json"), JSON.stringify({
      favicon: {
        autoGenerate: true,
        source: "lucide:message-circle",
        style: {
          from: "#111111",
          to: "#222222",
        },
      },
    }));
    await prepareIcon(app);
    expect(await Bun.file(file!).text()).not.toBe(svg);
  });

  test("writes the default App icon", async () => {
    const app = join(root, "default");
    await mkdir(join(app, ".config"), { recursive: true });
    await Bun.write(join(app, ".config", "site.json"), JSON.stringify({
      type: "app",
    }));
    await Bun.write(join(app, "package.json"), "{}\n");
    const file = await prepareIcon(app);
    expect(await Bun.file(file!).text()).toContain("data-luon-site-icon");
  });

  test("preserves a manually managed Site icon", async () => {
    const app = join(root, "manual");
    await mkdir(join(app, ".config"), { recursive: true });
    await Bun.write(join(app, ".config", "site.json"), JSON.stringify({
      type: "app",
    }));
    await Bun.write(join(app, "package.json"), JSON.stringify({
      favicon: {
        autoGenerate: false,
        source: "lucide:message-circle",
      },
    }));
    const file = join(app, "public", "favicon.svg");
    await mkdir(join(app, "public"), { recursive: true });
    await Bun.write(file, "<svg>custom</svg>");
    expect(await prepareIcon(app, { required: true })).toBe(file);
    expect(await Bun.file(file).text()).toBe("<svg>custom</svg>");

    await rm(file);
    expect(await prepareIcon(app)).toBeUndefined();
    await expect(prepareIcon(app, { required: true }))
      .rejects.toThrow("favicon.autoGenerate is false");
  });

  test("writes the configured icon for a Web Site", async () => {
    const web = join(root, "web");
    await mkdir(join(web, ".config"), { recursive: true });
    await Bun.write(join(web, ".config", "site.json"), JSON.stringify({
      type: "web",
    }));
    await Bun.write(join(web, "package.json"), JSON.stringify({
      favicon: {
        autoGenerate: true,
        source: "lucide:globe",
      },
    }));
    const file = await prepareIcon(web);
    expect(file).toBe(join(web, "public", "favicon.svg"));
    expect(await Bun.file(file!).text()).toContain("data-luon-site-icon");
  });

  test("embeds an image source in the generated favicon", async () => {
    const bot = join(root, "bot");
    await mkdir(join(bot, ".config"), { recursive: true });
    await mkdir(join(bot, "public"), { recursive: true });
    await Bun.write(join(bot, ".config", "site.json"), JSON.stringify({
      type: "bot",
    }));
    await Bun.write(join(bot, "public", "logo.svg"), "<svg></svg>");
    await Bun.write(join(bot, "package.json"), JSON.stringify({
      favicon: {
        autoGenerate: true,
        source: "image:public/logo.svg",
      },
    }));
    const file = await prepareIcon(bot);
    expect(await Bun.file(file!).text()).toContain("data:image/svg+xml;base64,");

    await Bun.write(join(bot, "package.json"), JSON.stringify({
      favicon: {
        autoGenerate: true,
        source: "emoji:🤖",
      },
    }));
    await expect(prepareIcon(bot)).rejects.toThrow(
      "Favicon source must use lucide: or image:.",
    );
  });
});
