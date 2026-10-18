/**
 * Offline password reset for when email is not configured. Hashes with Better Auth (never stores
 * plain text) and signs the user out on every device. Two-factor stays as it was.
 *
 * Usage (PowerShell or any shell): npm run reset-password -- <email> <newPassword>
 * Tip: wrap the password in single quotes if it contains spaces or $ characters.
 */
import { loadEnvConfig } from "@next/env";
import { MongoClient } from "mongodb";
import { createAuth } from "../src/server/auth/auth";
import { resetPasswordOffline } from "../src/server/auth/offline-reset";
import { parseEnv } from "../src/server/env";

async function main() {
  const [email, newPassword] = process.argv.slice(2);
  if (!email || !newPassword) {
    console.error("Usage: npm run reset-password -- <email> <newPassword>");
    process.exit(1);
  }

  loadEnvConfig(process.cwd());
  const env = parseEnv(process.env);
  const client = new MongoClient(env.MONGODB_URI, { serverSelectionTimeoutMS: 15_000 });
  try {
    await client.connect();
    const auth = createAuth({
      db: client.db(),
      client,
      secret: env.BETTER_AUTH_SECRET,
      baseURL: env.BETTER_AUTH_URL,
      nextJs: false,
    });
    await resetPasswordOffline(auth, email, newPassword);
    console.log(`Password updated for ${email}. All of their sessions were signed out.`);
  } finally {
    await client.close();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
