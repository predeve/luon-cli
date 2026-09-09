import { mkdir, rm, writeFile } from "node:fs/promises";
import { homedir, userInfo } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { logRoot } from "./log";
import { globalCli } from "./patch-install";
import { patchRoot } from "./patch-state";
import { autoDesktop, autoTask } from "./auto-login";

const label = "dev.luon.update";
const quote = (s: string) => `'${s.replaceAll("'", "'\\''")}'`;
const xml = (s: string) => s.replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;").replaceAll(">", "&gt;");

export function autoPlist(command: string[], log: string) {
  const args = command.map(s => `<string>${xml(s)}</string>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
<key>Label</key><string>${label}</string>
<key>ProgramArguments</key><array>${args}</array>
<key>StartInterval</key><integer>60</integer>
<key>RunAtLoad</key><true/>
<key>ProcessType</key><string>Background</string>
<key>StandardOutPath</key><string>${xml(log)}</string>
<key>StandardErrorPath</key><string>${xml(log)}</string>
</dict></plist>`;
}

async function run(command: string[], input?: string) {
  const child = Bun.spawn(command, { stdin: input === undefined ? "ignore"
    : new Blob([input]), stdout: "pipe", stderr: "pipe" });
  const [code, out, error] = await Promise.all([child.exited,
    new Response(child.stdout).text(), new Response(child.stderr).text()]);
  return { code, out, error };
}
async function required(command: string[], input?: string) {
  const result = await run(command, input);
  if (result.code) throw new Error(result.error.trim() || "Scheduler failed.");
  return result.out;
}

export function autoCron(current: string, command: string[], active: boolean,
  log: string) {
  const start = "# BEGIN LUON AUTO UPDATE";
  const end = "# END LUON AUTO UPDATE";
  const clean = current.replace(
    /(?:^|\n)# BEGIN LUON AUTO UPDATE\n[\s\S]*?# END LUON AUTO UPDATE\n?/g,
    "\n",
  ).trimEnd();
  if (!active) return clean ? `${clean}\n` : "";
  const job = command.map(quote).join(" ").replaceAll("%", "\\%");
  const output = quote(log).replaceAll("%", "\\%");
  return `${clean}\n${start}\n* * * * * ${job} >> ${output} 2>&1\n`
    + `@reboot ${job} >> ${output} 2>&1\n${end}\n`;
}

export async function autoStartup(active: boolean, upgrade = false) {
  const command = [process.execPath, globalCli(), "update", "--auto-run"];
  const log = join(logRoot(), "cli", "auto-update.log");
  await mkdir(dirname(log), { recursive: true, mode: 0o700 });
  if (process.platform === "darwin") {
    const domain = `gui/${userInfo().uid}`;
    const file = join(homedir(), "Library/LaunchAgents", `${label}.plist`);
    if (!active) {
      if (await Bun.file(file).exists()) {
        await required(["launchctl", "disable", `${domain}/${label}`]);
      }
      return;
    }
    if (upgrade) {
      if (!await Bun.file(file).exists()) return;
      const disabled = await required(["launchctl", "print-disabled", domain]);
      if (disabled.includes(`"${label}" => true`)) return;
    }
    await mkdir(dirname(file), { recursive: true, mode: 0o700 });
    await writeFile(file, autoPlist(command, log), { mode: 0o600 });
    await required(["launchctl", "enable", `${domain}/${label}`]);
    const loaded = await run(["launchctl", "print", `${domain}/${label}`]);
    // Do not terminate an updater that is already installing packages.
    if (!loaded.code && /state = running/.test(loaded.out)) return;
    if (!loaded.code) await required(["launchctl", "bootout", `${domain}/${label}`]);
    await required(["launchctl", "bootstrap", domain, file]);
    return;
  }
  if (process.platform === "win32") {
    if (!active) {
      const found = await run(["schtasks", "/Query", "/TN", label]);
      if (!found.code) await required([
        "schtasks", "/Change", "/TN", label, "/DISABLE",
      ]);
      return;
    }
    if (upgrade) {
      const old = await run(["schtasks", "/Query", "/TN", label, "/XML"]);
      if (old.code || /<Enabled>false<\/Enabled>/i.test(old.out)) return;
    }
    const user = (await required(["powershell.exe", "-NoProfile",
      "-NonInteractive", "-Command",
      "[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value",
    ])).trim();
    if (!/^S-1-[0-9-]+$/.test(user)) throw new Error("Cannot identify task user.");
    await mkdir(patchRoot, { recursive: true, mode: 0o700 });
    const file = join(patchRoot, `auto-task-${crypto.randomUUID()}.xml`);
    try {
      await writeFile(file, Buffer.from(`\uFEFF${autoTask(command, user)}`,
        "utf16le"), { mode: 0o600 });
      await required(["schtasks", "/Create", "/TN", label, "/XML", file, "/F"]);
    } finally { await rm(file, { force: true }); }
    return;
  }
  if (process.platform === "linux") {
    const current = await run(["crontab", "-l"]);
    if (current.code && !/no crontab/i.test(current.error)) {
      throw new Error(current.error || "Cannot read the user crontab.");
    }
    if (upgrade && !/# BEGIN LUON AUTO UPDATE\n(?:0|\*) \* \* \* \* /m
      .test(current.out)) return;
    await required(["crontab", "-"], autoCron(current.out, command, active, log));
    const env = process.env.XDG_CONFIG_HOME;
    const config = env && isAbsolute(env) ? env : join(homedir(), ".config");
    const file = join(config, "autostart", `${label}.desktop`);
    const script = join(patchRoot, "auto-login.sh");
    if (!active) {
      await rm(file, { force: true });
      await rm(script, { force: true });
      return;
    }
    if (upgrade && /^Hidden=true$/m.test(await Bun.file(file).text()
      .catch(() => ""))) return;
    await mkdir(patchRoot, { recursive: true, mode: 0o700 });
    await mkdir(dirname(file), { recursive: true, mode: 0o700 });
    await writeFile(script, `#!/bin/sh\nexec ${command.map(quote).join(" ")} `
      + `>> ${quote(log)} 2>&1\n`, { mode: 0o700 });
    await writeFile(file, autoDesktop(script), { mode: 0o600 });
    return;
  }
  throw new Error("Automatic updates are not supported on this platform.");
}
