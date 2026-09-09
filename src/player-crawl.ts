import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

export async function crawlAssets(root: string, platform: string,
  arch: string) {
  const entry = fileURLToPath(import.meta.resolve("@luon/crawl"));
  const require = createRequire(entry);
  const worker = join(dirname(entry), "worker.ts");
  const result = await Bun.build({
    entrypoints: [worker], target: "bun", minify: true,
    external: ["playwright-core"],
  });
  if (!result.success) throw new AggregateError(result.logs,
    "Could not bundle the browser script worker.");
  const files: Record<string, Uint8Array> = {
    "worker.js": new Uint8Array(await result.outputs[0]!.arrayBuffer()),
  };
  const folder = dirname(require.resolve("playwright-core/package.json"));
  for await (const path of new Bun.Glob("**/*").scan(folder)) {
    files[`node_modules/playwright-core/${path}`] =
      await Bun.file(join(folder, path)).bytes();
  }
  const suffix = platform === "linux" ? "-gnu"
    : platform === "win32" ? "-msvc" : "";
  const target = `${platform}-${arch}${suffix}`;
  const name = `@oxfmt/binding-${target}`;
  const format = createRequire(require.resolve("@luon/format"));
  const meta = await Bun.file(join(dirname(format.resolve("@luon/format")),
    "../package.json")).json();
  const version = meta.optionalDependencies[name];
  if (!version) throw Error(`Unsupported browser formatter target: ${target}`);
  const filename = `oxfmt.${target}.node`;
  if (platform === process.platform && arch === process.arch) {
    files["format.node"] = await Bun.file(format.resolve(name)).bytes();
  } else {
    const response = await fetch(
      `https://registry.npmjs.org/${encodeURIComponent(name)}/${version}`,
    );
    if (!response.ok) throw Error(`Could not resolve ${name}@${version}.`);
    const release = await response.json() as {
      dist: { tarball: string; integrity: string };
    };
    const download = await fetch(release.dist.tarball);
    if (!download.ok) throw Error(`Could not download ${name}@${version}.`);
    const bytes = await download.bytes();
    const hash = new Bun.CryptoHasher("sha512").update(bytes).digest("base64");
    if (release.dist.integrity !== `sha512-${hash}`) {
      throw Error(`Formatter integrity check failed: ${name}`);
    }
    const archive = await new Bun.Archive(bytes).files();
    const binding = archive.get(`package/${filename}`);
    if (!binding) throw Error(`Formatter archive is missing ${filename}.`);
    files["format.node"] = await binding.bytes();
  }
  const output = join(root, "crawl.tar.gz");
  await Bun.write(output, await new Bun.Archive(files,
    { compress: "gzip" }).bytes());
  return output;
}
