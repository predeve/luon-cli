import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { initProject } from "../src/init.ts";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => (
    rm(root, { force: true, recursive: true })
  )));
});

describe("CLI init", () => {
  test("creates an Act and Tailwind Site", async () => {
    const root = await mkdtemp(join(tmpdir(), "luon-init-"));
    roots.push(root);
    await initProject(root);
    const pkg = await Bun.file(join(root, "package.json")).json() as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    expect(pkg.dependencies).toMatchObject({
      "@luon/runtime": "latest",
      "@luon/ui": "latest",
      "@luon/view": "latest",
    });
    expect(pkg.dependencies.react).toBeUndefined();
    expect(pkg.dependencies["react-dom"]).toBeUndefined();
    expect(pkg.dependencies["lucide-react"]).toBeUndefined();
    expect(pkg.devDependencies).toMatchObject({
      tailwindcss: "latest",
    });
    expect(pkg.devDependencies.shadcn).toBeUndefined();
    expect(await Bun.file(join(root, "app.config.json")).json()).toEqual({
      icons: { autoGenerate: false },
    });
    expect(await Bun.file(join(root, "components.json")).exists()).toBeFalse();
    expect(await Bun.file(join(root, ".build", "components.json")).exists())
      .toBeFalse();
    const tsconfig = await Bun.file(join(root, "tsconfig.json")).json();
    expect(tsconfig.compilerOptions).toMatchObject({
      paths: { "@/*": ["./*"] },
    });
    expect(tsconfig.compilerOptions.baseUrl).toBeUndefined();
    expect(tsconfig.include).toContain(".build/auto-imports.d.ts");
    const ignore = await Bun.file(join(root, ".gitignore")).text();
    expect(ignore).toContain(".preview/");
    const css = await Bun.file(
      join(root, "app", "assets", "style.css"),
    ).text();
    expect(css).toContain('@import "tailwindcss" source("..");');
    expect(css).toContain("@theme inline");
    expect(css).not.toContain("shadcn");
    expect(css).not.toContain("tw-animate-css");
    expect(await Bun.file(join(root, "app", "pages", "index.tsx"))
      .exists()).toBeTrue();
    expect(await Bun.file(join(root, "app", "layouts", "default.tsx"))
      .exists()).toBeTrue();
    expect((await stat(join(root, "app", "hooks"))).isDirectory()).toBeTrue();
    expect((await stat(join(root, "app", "routes"))).isDirectory()).toBeTrue();
  });
});
