export type Command =
  | "agent"
  | "app"
  | "build"
  | "dev"
  | "export"
  | "file"
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

export type AppAction = "build" | "check" | "install" | "open";

export type AppTarget =
  | "linux-arm64"
  | "linux-x64"
  | "macos-arm64"
  | "windows-arm64"
  | "windows-x64";

export type Args = {
  command: Command;
  action?: ServiceAction;
  appAction?: AppAction;
  appUrl?: string;
  check?: boolean;
  detail?: boolean;
  json?: boolean;
  open: boolean;
  output?: string;
  preference?: "optimize" | "compatible";
  port?: number;
  root: string;
  site?: string;
  target?: AppTarget;
  topic?: Command;
  view?: "browser" | "headless" | "webview";
  yes: boolean;
};

const commands = new Set<Command>([
  "agent",
  "app",
  "build",
  "dev",
  "export",
  "file",
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

const appTargets = new Set<AppTarget>([
  "linux-arm64",
  "linux-x64",
  "macos-arm64",
  "windows-arm64",
  "windows-x64",
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
  if (action === "build") {
    const root = values.shift() || "";
    let output: string | undefined;
    let target: AppTarget | undefined;
    let preference: "optimize" | "compatible" = "optimize";
    let hasPreference = false;
    while (values.length) {
      const option = values.shift();
      const value = values.shift();
      if (option === "--out" && output === undefined && value) {
        output = value;
      } else if (option === "--target" && target === undefined
        && value && appTargets.has(value as AppTarget)) {
        target = value as AppTarget;
      } else if (option === "--preference" && !hasPreference
        && (value === "optimize" || value === "compatible")) {
        preference = value;
        hasPreference = true;
      } else {
        throw new Error(
          "Use luon app build <package.luon> [--out path] [--target platform].",
        );
      }
    }
    if (!root.toLowerCase().endsWith(".luon")) {
      throw new Error(
        "Use luon app build <package.luon> [--out path] [--target platform].",
      );
    }
    return {
      appAction: action,
      command: "app",
      open: false,
      output,
      preference,
      root,
      target,
      yes: false,
    };
  }
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

function parseFile(root: string, values: string[]): Args {
  let view: Args["view"] = "webview";
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index]!;
    if (value === "--browser") view = "browser";
    else if (value === "--headless") view = "headless";
    else if (value === "--webview") view = "webview";
    else if (value === "--view") {
      const next = values[++index];
      if (!next || !["browser", "headless", "webview"].includes(next)) {
        throw new Error("--view must be webview, browser, or headless.");
      }
      view = next as Args["view"];
    } else {
      throw new Error(`Unknown .luon option: ${value}`);
    }
  }
  return {
    command: "file",
    open: false,
    root,
    view,
    yes: false,
  };
}

function parseExport(values: string[]): Args {
  if (values.includes("--help")) return {
    command: "help",
    open: false,
    root: ".",
    topic: "export",
    yes: false,
  };
  const site = values.shift() || "";
  if (!/^(?:web|app)-[a-z0-9-]{1,64}$/.test(site) || values.length) {
    throw new Error("Use luon export <site-id>.");
  }
  return { command: "export", open: false, root: ".", site, yes: false };
}

export function parseArgs(raw: string[]): Args {
  const values = [...raw];
  const first = values.shift() || "help";
  if (first.toLowerCase().endsWith(".luon") || first.startsWith("file:")) {
    return parseFile(first, values);
  }
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
  if (command === "file") {
    const root = values.shift();
    if (!root) throw new Error("Use luon file <package.luon>.");
    return parseFile(root, values);
  }
  if (command === "export") return parseExport(values);
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
