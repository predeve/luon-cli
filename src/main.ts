import { parseArgs, type Command } from "./args.ts";

const help: Record<Command, string> = {
  agent: "luon agent [install|start|stop|restart|status|open]",
  app: "luon app build <package.luon> [--out path] [--target platform]\n"
    + "  [--preference optimize|compatible] (default: optimize)\n"
    + "Targets: macos-arm, windows-x86, windows-arm, linux-x86, "
    + "linux-arm\nluon app [check|install]",
  build: "luon build [path]",
  dev: "luon dev [path] [--port number] [--open]",
  export: "luon export <site-id>",
  file: "luon file <package.luon> [--webview|--browser|--headless]",
  help: "luon help [command]",
  init: "luon init [path] [--yes]",
  login: "luon login",
  logs: "luon logs [path]",
  logout: "luon logout",
  prepare: "luon prepare [path]",
  start: "luon start [path] [--port number] [--open]",
  status: "luon status [path]",
  stop: "luon stop [path]",
  update: "luon update [--auto|--check]\n"
    + "  --auto   Open the update prompt\n"
    + "  --check  Open automatic update settings",
  version: "luon version [--json]",
};

function show(topic?: Command) {
  if (topic && topic !== "help") {
    console.log(help[topic]);
    return;
  }
  console.log([
    "Luon CLI",
    "",
    "  luon init [path]      Create an app",
    "  luon login            Connect to your Luon Core",
    "  luon logout           Disconnect this computer",
    "  luon prepare [path]   Generate Runtime and auto-import files",
    "  luon dev [path]       Run the development server",
    "  luon build [path]     Build for production",
    "  luon export <site-id> Export an owned server Site as .luon",
    "  luon start [path]     Run the production build",
    "  luon stop [path]      Stop an Agent-managed Site",
    "  luon status [path]    Show a managed Site",
    "  luon logs [path]      Print its log path",
    "  luon agent [action]   Control local Sites and dashboard",
    "  luon app install      Install the local App launcher",
    "  luon app check        Verify the native WebView package",
    "  luon app build <file> Build a native desktop app",
    "  luon product.luon     Run a portable Luon package",
    "  luon update           Update Luon packages and installed apps",
    "  luon update --auto    Open the update prompt",
    "  luon update --check   Open automatic update settings",
    "  luon version          Print the CLI version",
    "",
  ].join("\n"));
}

async function version(detail = false, json = false) {
  const { installedVersions, versionLine } = await import("./version.ts");
  const value = await installedVersions();
  console.log(
    json ? JSON.stringify(value) : detail ? versionLine(value) : value.cli,
  );
}

export async function main(raw: string[]) {
  const args = parseArgs(raw);
  if (args.command === "help") return show(args.topic);
  if (args.command === "version") return version(args.detail, args.json);
  if (process.env.LUON_STANDALONE !== "1") {
    const { syncAuto } = await import("./auto-update");
    await syncAuto().catch(error => {
      console.error("Automatic update schedule:", String(error));
    });
  }
  if (args.command === "login" || args.command === "logout") {
    const { login, logout } = await import("./account.ts");
    return args.command === "login" ? login() : logout();
  }
  if (args.command === "init") {
    const { initProject } = await import("./init.ts");
    return initProject(args.root, args.yes);
  }
  if (args.command === "app") {
    if (args.appAction === "build") {
      const { buildStandalone } = await import("./standalone.ts");
      return buildStandalone(args);
    }
    const { runApp } = await import("./app.ts");
    return runApp(args);
  }
  if (args.command === "file") {
    const { runLuonFile } = await import("./luon-file.ts");
    return runLuonFile(args);
  }
  if (args.command === "export") {
    const { exportSite } = await import("./export.ts");
    return exportSite(args.site!);
  }
  if (args.command === "prepare") {
    const { updatePackages } = await import("./packages.ts");
    await updatePackages(args.root);
    const { prepareProject } = await import("@luon/runtime/project");
    return prepareProject(args.root);
  }
  if (args.command === "dev" || args.command === "start") {
    const { runDev, runStart } = await import("./process.ts");
    return args.command === "dev" ? runDev(args) : runStart(args);
  }
  if (["agent", "logs", "status", "stop"].includes(args.command)) {
    const { runService } = await import("./service.ts");
    return runService(args);
  }
  if (args.command === "update") {
    if (args.check) {
      const { openAuto } = await import("./auto-dialog");
      return openAuto();
    }
    if (args.autoRun) {
      const { runAuto } = await import("./auto-update");
      return runAuto();
    }
    if (args.auto) {
      const { offerPatch } = await import("./patch-dialog");
      const accepted = await offerPatch("engine", "Luon update",
        "Update Luon and installed apps.\nYour app data and logins are kept.",
        { manual: true });
      if (!accepted) return;
    }
    const { updateCli } = await import("./update.ts");
    const { installedVersions } = await import("./version.ts");
    return updateCli({
      check: false,
      current: await installedVersions(),
    });
  }
  const { updatePackages } = await import("./packages.ts");
  await updatePackages(args.root);
  const { buildProject } = await import("@luon/runtime/build");
  const { syncDb } = await import("@luon/runtime/db-sync");
  const { buildWorker } = await import("@luon/worker/build");
  const result = await buildProject(args.root);
  if (result.mode === "fullstack") await syncDb(args.root);
  const worker = result.mode === "fullstack"
    ? await buildWorker(result.outdir)
    : { outputs: [] };
  console.log(
    `Luon build complete: ${result.outputs.length + worker.outputs.length} files`
      + ` · ${result.outdir}`,
  );
}
