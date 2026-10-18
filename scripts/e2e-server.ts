/**
 * Playwright web server: starts an in-memory MongoDB replica set, builds the app and runs
 * `next start` on port 3100 against it, so e2e tests never touch the Atlas database in .env.local.
 * (A production server also avoids clashing with a `next dev` you may have running on 3000.)
 * Usage (via playwright.config.ts): tsx scripts/e2e-server.ts
 */
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { MongoMemoryReplSet } from "mongodb-memory-server";

const PORT = 3100;
const NEXT_BIN = path.join(process.cwd(), "node_modules", "next", "dist", "bin", "next");

function runNext(args: string[], env: NodeJS.ProcessEnv): ChildProcess {
  return spawn(process.execPath, [NEXT_BIN, ...args], { stdio: "inherit", env });
}

async function main() {
  const replSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: "wiredTiger" },
    instanceOpts: [{ launchTimeout: 60_000 }],
  });
  const url = `http://localhost:${PORT}`;
  // Process env overrides .env.local in Next.js.
  const env = {
    ...process.env,
    MONGODB_URI: replSet.getUri("wealthtrack-e2e"),
    BETTER_AUTH_URL: url,
    APP_URL: url,
    DISABLE_SIGNUP: "false",
  };

  let child: ChildProcess | undefined;
  const shutdown = async (code: number) => {
    child?.kill();
    await replSet.stop();
    process.exit(code);
  };
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => void shutdown(0));
  }

  if (process.env.E2E_SKIP_BUILD !== "1") {
    child = runNext(["build"], env);
    const code = await new Promise<number>((resolve) => child!.on("exit", (c) => resolve(c ?? 1)));
    if (code !== 0) await shutdown(code);
  }

  child = runNext(["start", "--port", String(PORT)], env);
  child.on("exit", (code) => void shutdown(code ?? 0));
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
