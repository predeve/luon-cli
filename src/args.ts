export type Command =
  | "agent"
  | "app"
  | "build"
  | "dev"
  | "help"
  | "init"
  | "login"
  | "logs"
  | "logout"
  | "prepare"
  | "start"
  | "status"
  | "stop"
  | "update"
  | "version";

export type ServiceAction =
  | "install"
  | "open"
  | "restart"
  | "start"
  | "status"
  | "stop";

export type AppAction = "check" | "install" | "open";

export type Args = {
  command: Command;
  action?: ServiceAction;
  appAction?: AppAction;
  appUrl?: string;
  check?: boolean;
  detail?: boolean;
  json?: boolean;
  open: boolean;
  port?: number;
  root: string;
  topic?: Command;
  yes: boolean;
};

const commands = new Set<Command>([
  "agent",
  "app",
  "build",
  "dev",
  "help",
  "init",
  "login",
  "logs",
  "logout",
  "prepare",
  "start",
  "status",
  "stop",
  "update",
  "version",
]);

const actions = new Set<ServiceAction>([
  "install",
  "open",
  "restart",
  "start",
  "status",
  "stop",
]);

function parseService(command: "agent", values: string[]): Args {
  if (values.includes("--help")) return {
    command: "help",
    open: false,
    root: ".",
    topic: command,
    yes: false,
  };
  const action = (values.shift() || "status") as ServiceAction;
  if (!actions.has(action) || values.length) {
    throw new Error(`Unknown action for luon ${command}: ${action}`);
  }
  return { action, command, open: false, root: ".", yes: false };
}

function parseApp(values: string[]): Args {
  if (values.includes("--help")) return {
    command: "help",
    open: false,
    root: ".",
    topic: "app",
    yes: false,
  };
  const action = (values.shift() || "install") as AppAction;
  if (["check", "install"].includes(action) && !values.length) {
    return { appAction: action, command: "app", open: false, root: ".", yes: false };
  }
  if (action === "open" && values.length === 1) {
    return {
      appAction: action,
      appUrl: values[0],
      command: "app",
      open: false,
      root: ".",
      yes: false,
    };
  }
  throw new Error(`Unknown action for luon app: ${action}`);
}

function parseUpdate(values: string[]): Args {
  if (values.includes("--help")) return {
    command: "help",
    open: false,
    root: ".",
    topic: "update",
    yes: false,
  };
  let check = false;
  for (const value of values) {
    if (value === "--check") check = true;
    else throw new Error(`Unknown option for luon update: ${value}`);
  }
  return {
    check,
    command: "update",
    open: false,
    root: ".",
    yes: false,
  };
}

function parseVersion(values: string[]): Args {
  if (values.includes("--help")) return {
    command: "help",
    open: false,
    root: ".",
    topic: "version",
    yes: false,
  };
  if (values.length > 1 || (values[0] && values[0] !== "--json")) {
    throw new Error(`Unknown option for luon version: ${values[0]}`);
  }
  return {
    command: "version",
    json: values[0] === "--json",
    open: false,
    root: ".",
    yes: false,
  };
}

export function parseArgs(raw: string[]): Args {
  const values = [...raw];
  const first = values.shift() || "help";
  if (first === "--help") return {
    command: "help",
    open: false,
    root: ".",
    yes: false,
  };
  if (first === "--version" || first === "-v") return {
    command: "version",
    detail: first === "-v",
    open: false,
    root: ".",
    yes: false,
  };
  if (!commands.has(first as Command)) {
    throw new Error(`Unknown Luon command: ${first}`);
  }
  const command = first as Command;
  if (command === "help") {
    const topic = values.shift();
    if (values.length || (topic && !commands.has(topic as Command))) {
      throw new Error(`Unknown Luon help topic: ${topic || values[0]}`);
    }
    return {
      command,
      open: false,
      root: ".",
      topic: topic as Command | undefined,
      yes: false,
    };
  }
  if (command === "update") return parseUpdate(values);
  if (command === "version") return parseVersion(values);
  if (command === "agent") return parseService(command, values);
  if (command === "app") return parseApp(values);
  if (["login", "logout"].includes(command)) {
    if (values.includes("--help")) return {
      command: "help",
      open: false,
      root: ".",
      topic: command,
      yes: false,
    };
    if (values.length) {
      throw new Error(`luon ${command} does not accept arguments.`);
    }
    return { command, open: false, root: ".", yes: false };
  }
  let root = ".";
  let port: number | undefined;
  let open = false;
  let yes = false;
  let position = false;
  let option = false;
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index]!;
    if (!value.startsWith("-")) {
      if (option) {
        throw new Error("Put the Luon app path before command options.");
      }
      if (position) throw new Error(`Too many arguments for luon ${command}.`);
      root = value;
      position = true;
      continue;
    }
    option = true;
    if (value === "--help") {
      return { command: "help", open, root, topic: command, yes };
    }
    if (value === "--open" && ["dev", "start"].includes(command)) {
      open = true;
      continue;
    }
    if (value === "--yes" && command === "init") {
      yes = true;
      continue;
    }
    if (value === "--port" && ["dev", "start"].includes(command)) {
      const next = values[++index];
      port = Number(next);
      if (!next || !Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error("--port must be between 1 and 65535.");
      }
      continue;
    }
    throw new Error(`Unknown option for luon ${command}: ${value}`);
  }
  return { command, open, port, root, yes };
}
