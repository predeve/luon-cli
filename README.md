# @luon/cli

Part of [Luon](https://www.luon.dev) — Create, develop, build, and run Luon apps.

[Package guide](https://pkg.luon.dev/packages/cli/) ·
[Source](https://github.com/predeve/luon-cli) ·
[Developer tools](https://www.luon.dev/tools)

## Install

macOS users run this in Terminal:

```bash
curl -fsSL https://pkg.luon.dev/install.sh | bash
```

Ubuntu 22.04+ users run this in a terminal:

```bash
sudo apt-get update && sudo apt-get install -y curl && \
  curl -fsSL https://pkg.luon.dev/install.sh | bash
```

Windows users run this in PowerShell, not Command Prompt:

```powershell
irm https://pkg.luon.dev/install.ps1 | iex
```

The Linux installer prepares dependencies automatically on compatible
apt-based systems. Other glibc distributions need curl, unzip, GTK3 and
WebKitGTK 4.1 installed manually. Alpine/musl is not supported.

## Who it is for

Developers creating, running, building, and updating Luon Sites.

## Core concepts

### Project creation

init writes a minimal Site, scoped registry configuration, and the package metadata needed by Runtime preparation.

### Assigned Core account

login uses Hub to reach the account's assigned Core and stores its separate CLI session under ~/.luon/account.json.

### One preparation path

prepare, dev, and build use the same discovery and generated contracts, so development does not hide a separate production framework.

### Local process ownership

dev and start register work with Agent, while CLI coordinates project preparation and user-facing terminal output.

### Package alignment

update resolves CLI, Agent, Runtime, and Worker releases from pkg.luon.dev; workspace dependencies stay linked during Luon source development.

### Native Agent window

CLI installs WebView and its matching native package so agent install can open the address-bar-free window immediately.

### Original App Preview

app install registers the local luon:// launcher so Core can open
`luon://tmp.luon.dev/{id}` in WebView with the App Template's original window
settings. Without it, Core uses browser Preview.

### Portable Luon files

Every signed-in account can export an owned WEB or APP. Lite and Pro subscribers
can add a sharing PIN. Packages use an authenticated envelope, reject modified
bytes, and keep local data under ~/.luon. `app build` can turn one into a
standalone app.

## Quick reference

### Everyday commands

The CLI covers a Site from creation through local operation.

| Command | Use |
| --- | --- |
| luon init [path] | Create a minimal Site |
| luon prepare [path] | Regenerate routes, imports, and types |
| luon dev [path] | Run local HMR through Agent |
| luon build [path] | Create a production dist |
| luon export <site-id> | Export an owned Site as .luon |
| luon start [path] | Run an existing production build |
| luon stop / status / logs | Operate an Agent-owned Site |
| luon update [--check] | Inspect or align Luon packages |
| luon product.luon | Run a portable package in WebView |
| luon app build product.luon | Build a standalone desktop app |
| luon product.luon --browser | Use the default browser |
| luon product.luon --headless | Run without a window |

### Installation and state

Install once globally; keep project source and tool state separate.

| Item | Location or command |
| --- | --- |
| macOS | Run install.sh in Terminal |
| Linux | Ubuntu 22.04+ tested; apt dependencies are automatic |
| Windows | Run install.ps1 in PowerShell, not Command Prompt |
| Other Linux | glibc + GTK3 + WebKitGTK 4.1, or build from source |
| Account | ~/.luon/account.json |
| Agent state | ~/.luon/agent |
| Generated Site files | <site>/.build |
| Production output | <site>/dist |

### Local interfaces

Use the terminal or the visual controller for the same local work.

| Need | Interface |
| --- | --- |
| Create, prepare, build | luon CLI |
| Inspect processes and logs | Agent dashboard |
| Open the dashboard | agent.luon.dev or luon agent open |
| Open an APP Template | luon:// launcher and WebView |
| Open a portable Site | Double-click .luon or run luon file.luon |

## Examples

### Connect your Luon account

The browser completes login through Hub and the assigned Core.

```bash
luon login
luon logout
```

### Create and develop a Site

The default port comes from the reserved 6100–6999 Site range.

```bash
luon init ./my-site
cd ./my-site
luon dev . --open
```

### Prepare and build

Run prepare alone when an editor needs regenerated types immediately.

```bash
luon prepare .
luon build .
luon start . --port 6100
```

### Update the package set

Check the current releases before updating the Site.

```bash
luon update --check
luon update
```

### Run a portable Site

WebView is the default; browser and headless modes are explicit.

```bash
luon ./product.luon
luon ./product.luon --browser
luon ./product.luon --headless
```

### Build a standalone app

The result runs without Luon CLI or Bun on the destination.

```bash
luon app build ./product.luon
luon app build ./product.luon --out ./release/Product
luon app build ./product.luon --target windows-x86
```

## API reference

### `luon init [path]`

Create a Site and registry configuration.

### `luon prepare [path]`

Regenerate routes, imports, and types.

### `luon dev [path]`

Start Bun HMR and local processes.

### `luon build [path]`

Create a static or full-stack dist.

### `luon start [path]`

Run an existing production build.

### `luon stop / status / logs`

Control a managed Site.

### `luon agent [action]`

Control local execution and dashboard.

### `luon app install`

Install the local App Preview launcher.

### `luon app build <file.luon>`

Build a host or cross-compiled standalone desktop app.

### `luon update [--check]`

Check or install current packages.

### `luon help / version`

Print command usage or versions.

## Runtime flow

1. Install the CLI globally from the Luon registry.
2. Use login to connect this computer to the account's assigned Core.
3. Initialize or enter a Site and generate its .build contracts.
4. Use dev for HMR or build to create a production dist.
5. Use start only after a successful production build.
6. Export .luon when a built Site must run without its source folder.
7. Use app build when the destination should not need Luon CLI or Bun.

## Boundaries

- --open is opt-in and browser control is not part of a normal build.
- prepare, dev, and build may align the Site's latest Luon dependencies.
- CLI state lives under ~/.luon; workspace logs stay in luon-logs.
- The CLI account file is private and never enters Site source or .build.
- .luon data persists under ~/.luon/{web|app}/{short-id}.
- New .luon files use automatic authenticated encryption and reject changes.
- Standalone builds default to the host or cross-compile with --target.
- Use luon help <command> for the installed version's exact options.

## More documentation

- [Complete CLI guide](https://docs.luon.dev/guide/cli)
- [Quick start](https://docs.luon.dev/guide/quick-start)
- [Build and run](https://docs.luon.dev/guide/build-run)
- [Portable Luon files](https://docs.luon.dev/guide/portable)
- [CLI source on GitHub](https://github.com/predeve/luon-cli)
- [WebView package](https://pkg.luon.dev/packages/webview/)

## License

[MIT](LICENSE) © predeve
