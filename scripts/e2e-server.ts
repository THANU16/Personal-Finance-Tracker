/**
 * Playwright web server: starts an in-memory MongoDB replica set, builds the app and runs
 * `next start` on port 3100 against it, so e2e tests never touch the Atlas database in .env.local.
 * (A production server also avoids clashing with a `next dev` you may have running on 3000.)
 * Usage (via playwright.config.ts): tsx scripts/e2e-server.ts
 */
import { spawn, type ChildProcess } from "node:child_process";
import { writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { MongoMemoryReplSet } from "mongodb-memory-server";

const PORT = 3100;
/** The console mail driver appends every email here; tests/e2e/auth.spec.ts reads it (same path). */
const E2E_MAIL_FILE = path.join(os.tmpdir(), "wealthtrack-e2e-mail.jsonl");
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
    // Tests register many users per minute; production limits would block them.
    AUTH_RATE_LIMIT: "off",
    // No real email in e2e: capture messages instead (the console driver logs nothing sensitive).
    RESEND_API_KEY: "",
    MAIL_CAPTURE_FILE: E2E_MAIL_FILE,
    REQUIRE_EMAIL_VERIFICATION: "false",
    // Fixed test secret so tests/e2e/essentials.spec.ts can call the daily job.
    CRON_SECRET: "e2e-cron-secret-not-for-production",
  };
  writeFileSync(E2E_MAIL_FILE, "");

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
