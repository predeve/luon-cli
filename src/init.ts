import { mkdir, readdir } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

import { prepareProject } from "@luon/runtime/project";

const favicon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <circle cx="32" cy="32" r="30" fill="#090b16"/>
  <g fill="none" stroke="#67e8f9" stroke-width="3">
    <ellipse cx="32" cy="32" rx="21" ry="8"/>
    <ellipse cx="32" cy="32" rx="21" ry="8" transform="rotate(60 32 32)"/>
    <ellipse cx="32" cy="32" rx="21" ry="8" transform="rotate(-60 32 32)"/>
  </g>
  <circle cx="32" cy="32" r="5" fill="#a78bfa"/>
</svg>
`;

const style = `@import "tailwindcss" source("..");

@custom-variant dark (&:is(.dark *));

@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-popover: var(--popover);
  --color-popover-foreground: var(--popover-foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-accent: var(--accent);
  --color-accent-foreground: var(--accent-foreground);
  --color-destructive: var(--destructive);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);
  --color-chart-1: var(--chart-1);
  --color-chart-2: var(--chart-2);
  --color-chart-3: var(--chart-3);
  --color-chart-4: var(--chart-4);
  --color-chart-5: var(--chart-5);
  --color-sidebar: var(--sidebar);
  --color-sidebar-foreground: var(--sidebar-foreground);
  --color-sidebar-primary: var(--sidebar-primary);
  --color-sidebar-primary-foreground: var(--sidebar-primary-foreground);
  --color-sidebar-accent: var(--sidebar-accent);
  --color-sidebar-accent-foreground: var(--sidebar-accent-foreground);
  --color-sidebar-border: var(--sidebar-border);
  --color-sidebar-ring: var(--sidebar-ring);
  --radius-sm: calc(var(--radius) * 0.6);
  --radius-md: calc(var(--radius) * 0.8);
  --radius-lg: var(--radius);
  --radius-xl: calc(var(--radius) * 1.4);
  --radius-2xl: calc(var(--radius) * 1.8);
  --radius-3xl: calc(var(--radius) * 2.2);
  --radius-4xl: calc(var(--radius) * 2.6);
}

:root {
  --radius: 0.625rem;
  --background: oklch(1 0 0);
  --foreground: oklch(0.145 0 0);
  --card: oklch(1 0 0);
  --card-foreground: oklch(0.145 0 0);
  --popover: oklch(1 0 0);
  --popover-foreground: oklch(0.145 0 0);
  --primary: oklch(0.205 0 0);
  --primary-foreground: oklch(0.985 0 0);
  --secondary: oklch(0.97 0 0);
  --secondary-foreground: oklch(0.205 0 0);
  --muted: oklch(0.97 0 0);
  --muted-foreground: oklch(0.556 0 0);
  --accent: oklch(0.97 0 0);
  --accent-foreground: oklch(0.205 0 0);
  --destructive: oklch(0.577 0.245 27.325);
  --border: oklch(0.922 0 0);
  --input: oklch(0.922 0 0);
  --ring: oklch(0.708 0 0);
  --chart-1: oklch(0.646 0.222 41.116);
  --chart-2: oklch(0.6 0.118 184.704);
  --chart-3: oklch(0.398 0.07 227.392);
  --chart-4: oklch(0.828 0.189 84.429);
  --chart-5: oklch(0.769 0.188 70.08);
  --sidebar: oklch(0.985 0 0);
  --sidebar-foreground: oklch(0.145 0 0);
  --sidebar-primary: oklch(0.205 0 0);
  --sidebar-primary-foreground: oklch(0.985 0 0);
  --sidebar-accent: oklch(0.97 0 0);
  --sidebar-accent-foreground: oklch(0.205 0 0);
  --sidebar-border: oklch(0.922 0 0);
  --sidebar-ring: oklch(0.708 0 0);
}

.dark {
  --background: oklch(0.145 0 0);
  --foreground: oklch(0.985 0 0);
  --card: oklch(0.205 0 0);
  --card-foreground: oklch(0.985 0 0);
  --popover: oklch(0.205 0 0);
  --popover-foreground: oklch(0.985 0 0);
  --primary: oklch(0.922 0 0);
  --primary-foreground: oklch(0.205 0 0);
  --secondary: oklch(0.269 0 0);
  --secondary-foreground: oklch(0.985 0 0);
  --muted: oklch(0.269 0 0);
  --muted-foreground: oklch(0.708 0 0);
  --accent: oklch(0.269 0 0);
  --accent-foreground: oklch(0.985 0 0);
  --destructive: oklch(0.704 0.191 22.216);
  --border: oklch(1 0 0 / 10%);
  --input: oklch(1 0 0 / 15%);
  --ring: oklch(0.556 0 0);
  --chart-1: oklch(0.488 0.243 264.376);
  --chart-2: oklch(0.696 0.17 162.48);
  --chart-3: oklch(0.769 0.188 70.08);
  --chart-4: oklch(0.627 0.265 303.9);
  --chart-5: oklch(0.645 0.246 16.439);
  --sidebar: oklch(0.205 0 0);
  --sidebar-foreground: oklch(0.985 0 0);
  --sidebar-primary: oklch(0.488 0.243 264.376);
  --sidebar-primary-foreground: oklch(0.985 0 0);
  --sidebar-accent: oklch(0.269 0 0);
  --sidebar-accent-foreground: oklch(0.985 0 0);
  --sidebar-border: oklch(1 0 0 / 10%);
  --sidebar-ring: oklch(0.556 0 0);
}

@layer base {
  * {
    @apply border-border outline-ring/50;
  }

  body {
    @apply bg-background text-foreground;
  }
}
`;

function id(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "luon-app";
}

export async function initProject(input: string, yes = false) {
  const root = resolve(input);
  const entries = await readdir(root).catch(() => []);
  if (entries.length && !yes) {
    throw new Error("Target folder is not empty. Use --yes to continue.");
  }
  await Promise.all([
    mkdir(join(root, "app", "assets"), { recursive: true }),
    mkdir(join(root, "app", "components"), { recursive: true }),
    mkdir(join(root, "app", "hooks"), { recursive: true }),
    mkdir(join(root, "app", "layouts"), { recursive: true }),
    mkdir(join(root, "app", "lib"), { recursive: true }),
    mkdir(join(root, "app", "pages"), { recursive: true }),
    mkdir(join(root, "app", "routes"), { recursive: true }),
    mkdir(join(root, "app", "stores"), { recursive: true }),
    mkdir(join(root, "app", "types"), { recursive: true }),
    mkdir(join(root, "app", "utils"), { recursive: true }),
    mkdir(join(root, "public"), { recursive: true }),
    mkdir(join(root, "server", "api"), { recursive: true }),
    mkdir(join(root, "server", "routes"), { recursive: true }),
    mkdir(join(root, "server", "types"), { recursive: true }),
    mkdir(join(root, "server", "utils"), { recursive: true }),
    mkdir(join(root, "shared", "types"), { recursive: true }),
    mkdir(join(root, "shared", "utils"), { recursive: true }),
  ]);
  const name = id(basename(root));
  await Promise.all([
    Bun.write(join(root, "bunfig.toml"), [
      "[install.scopes]",
      '"@luon" = { url = "https://pkg.luon.dev/" }',
      "",
    ].join("\n")),
    Bun.write(join(root, ".gitignore"), [
      "node_modules/",
      "db/",
      "dist/",
      ".build/",
      ".preview/",
      "",
    ].join("\n")),
    Bun.write(join(root, "package.json"), `${JSON.stringify({
      name,
      private: true,
      type: "module",
      favicon: { autoGenerate: false },
      dependencies: {
        "@luon/rule": "latest",
        "@luon/runtime": "latest",
        "@luon/style": "latest",
        "@luon/ui": "latest",
        "@luon/view": "latest",
        "@luon/worker": "latest",
        "@prisma/orm-postgres": "8.0.0-rc.8",
      },
      devDependencies: {
        "@prisma/cli-engine": "0.3.0",
        "@types/bun": "latest",
        tailwindcss: "latest",
        prisma: "8.0.0-rc.12",
        typescript: "latest",
      },
    }, null, 2)}\n`),
    Bun.write(join(root, "tsconfig.json"), `${JSON.stringify({
      compilerOptions: {
        allowImportingTsExtensions: true,
        jsx: "react-jsx",
        jsxImportSource: "@luon/view",
        lib: ["ESNext", "DOM"],
        module: "Preserve",
        moduleResolution: "bundler",
        noEmit: true,
        paths: { "@/*": ["./*"] },
        strict: true,
        target: "ESNext",
        types: ["bun"],
      },
      include: [".build/auto-imports.d.ts", "app", "server", "shared"],
    }, null, 2)}\n`),
    Bun.write(join(root, "app", "layouts", "default.tsx"), [
      "import type { LayoutProps } from \"@luon/runtime\";",
      "",
      "export default (props: LayoutProps) => props.children;",
      "",
    ].join("\n")),
    Bun.write(join(root, "app", "pages", "index.tsx"), [
      "export default () => (",
      '  <main class="grid min-h-svh place-items-center bg-background p-8">',
      '    <section class="space-y-3 text-center">',
      '      <h1 class="text-4xl font-semibold tracking-tight">',
      "        Luon is ready.",
      "      </h1>",
      '      <p class="text-muted-foreground">',
      "        Edit app/pages/index.tsx to begin.",
      "      </p>",
      "    </section>",
      "  </main>",
      ");",
      "",
    ].join("\n")),
    Bun.write(join(root, "app", "assets", "style.css"), style),
    Bun.write(join(root, "public", "favicon.svg"), favicon),
  ]);
  await prepareProject(root);
  console.log(`Luon app is ready: ${root}`);
}
