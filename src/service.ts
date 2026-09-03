import { resolve } from "node:path";

import type { Args, ServiceAction } from "./args.ts";

function line(name: string, value: unknown) {
  console.log(`${name}: ${String(value)}`);
}

async function agent(action: ServiceAction) {
  const api = await import("@luon/agent");
  if (action === "install") {
    const value = await api.installApp();
    line("Luon Agent", `installed · ${value.app}`);
    const launcher = await api.installLauncher();
    line("Luon App", `installed · ${launcher.app}`);
    const { registerDevice } = await import("./device.ts");
    const registered = await registerDevice().catch((error) => {
      console.warn(error instanceof Error ? error.message : String(error));
      return false;
    });
    line("Luon device", registered ? "registered" : "sign in to register");
    const opened = await api.openAgent();
    line("Control", opened.url);
    return;
  }
  if (action === "start") {
    const value = await api.startAgent();
    line("Luon Agent", `running · PID ${value.pid}`);
    return;
  }
  if (action === "stop") {
    line("Luon Agent", await api.stopAgent() ? "stopped" : "not running");
    return;
  }
  if (action === "restart") {
    const value = await api.restartAgent();
    line("Luon Agent", `running · PID ${value.pid}`);
    return;
  }
  if (action === "open") {
    const value = await api.openAgent();
    line("Luon Agent", value.url);
    return;
  }
  const value = await api.agentStatus();
  line("Luon Agent", value.running ? `running · PID ${value.pid}` : "stopped");
  if (value.running) {
    line("Managed Sites", value.jobs.length);
    line("Control", value.url);
  }
}

async function site(command: "logs" | "status" | "stop", root: string) {
  const api = await import("@luon/agent");
  const path = resolve(root);
  if (command === "stop") {
    line("Luon Site", await api.stopJob(path) ? "stopped" : "not running");
    return;
  }
  const job = await api.jobStatus(path);
  if (command === "logs") {
    if (!job) throw new Error(`No Agent-managed Site found at ${path}.`);
    console.log(job.log);
    return;
  }
  if (!job) {
    line("Luon Site", "not managed");
    return;
  }
  line("Luon Site", `${job.state} · ${job.mode}`);
  line("Root", job.root);
  line("PID", job.pid);
  line("Port", job.port);
  line("Log", job.log);
}

export async function runService(args: Args) {
  if (args.command === "agent") return agent(args.action || "status");
  if (args.command === "logs" || args.command === "status"
    || args.command === "stop") {
    return site(args.command, args.root);
  }
}
