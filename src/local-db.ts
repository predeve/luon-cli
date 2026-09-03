import { resolve } from "node:path";

type LocalDb = {
  close(): Promise<void>;
  url: string;
};

export async function startLocalDb(root: string): Promise<LocalDb | undefined> {
  if (process.env.DATABASE_URL) return;
  const pkg = await Bun.file(resolve(root, "package.json")).json().catch(
    () => ({}),
  ) as { data?: unknown };
  if (pkg.data !== "local") return;
  if (!await Bun.file(resolve(root, "db", "contract.json")).exists()) return;
  const { startPrismaDevServer } = await import("@prisma/dev");
  const name = `luon-${Bun.hash(resolve(root)).toString(16)}`;
  const server = await startPrismaDevServer({
    name,
    persistenceMode: "stateful",
  });
  return {
    close: () => server.close(),
    url: server.database.connectionString,
  };
}
