import { readFile } from "node:fs/promises";

export type Versions = {
  agent: string;
  cli: string;
  runtime: string;
  worker: string;
};

async function packageVersion(url: URL) {
  const pkg = JSON.parse(await readFile(url, "utf8")) as {
    version: string;
  };
  return pkg.version;
}

function packageFile(name: string) {
  const entry = import.meta.resolve(name);
  return new URL("../package.json", entry);
}

export async function installedVersions(): Promise<Versions> {
  const [agent, cli, runtime, worker] = await Promise.all([
    packageVersion(packageFile("@luon/agent")),
    packageVersion(new URL("../package.json", import.meta.url)),
    packageVersion(packageFile("@luon/runtime")),
    packageVersion(packageFile("@luon/worker")),
  ]);
  return { agent, cli, runtime, worker };
}

export function versionLine(value: Versions) {
  return `Luon CLI ${value.cli} · Agent ${value.agent}`
    + ` · Runtime ${value.runtime}`
    + ` · Worker ${value.worker}`;
}
