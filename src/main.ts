import { parseArgs, type Command } from "./args.ts";

const help: Record<Command, string> = {
  agent: "luon agent [install|start|stop|restart|status|open]",
  app: "luon app [check|install]",
  build: "luon build [path]",
  dev: "luon dev [path] [--port number] [--open]",
  help: "luon help [command]",
  init: "luon init [path] [--yes]",
  login: "luon login",
  logs: "luon logs [path]",
  logout: "luon logout",
  prepare: "luon prepare [path]",
  start: "luon start [path] [--port number] [--open]",
  status: "luon status [path]",
  stop: "luon stop [path]",
  update: "luon update [--check]",
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
    "  luon start [path]     Run the production build",
    "  luon stop [path]      Stop an Agent-managed Site",
    "  luon status [path]    Show a managed Site",
    "  luon logs [path]      Print its log path",
    "  luon agent [action]   Control local Sites and dashboard",
    "  luon app install      Install the local App launcher",
    "  luon app check        Verify the native WebView package",
    "  luon update           Update CLI, Agent, Runtime, and Worker",
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
  if (args.command === "login" || args.command === "logout") {
    const { login, logout } = await import("./account.ts");
    return args.command === "login" ? login() : logout();
  }
  if (args.command === "init") {
    const { initProject } = await import("./init.ts");
    return initProject(args.root, args.yes);
  }
  if (args.command === "app") {
    const { runApp } = await import("./app.ts");
    return runApp(args);
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
    const { updateCli } = await import("./update.ts");
    const { installedVersions } = await import("./version.ts");
    return updateCli({
      check: args.check === true,
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
