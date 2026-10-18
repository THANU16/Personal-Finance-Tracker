import "server-only";
import { betterAuth } from "better-auth";
import { mongodbAdapter } from "better-auth/adapters/mongodb";
import { nextCookies } from "better-auth/next-js";
import { MongoClient, type Db } from "mongodb";
import { getEnv } from "@/server/env";

export interface CreateAuthOptions {
  db: Db;
  client: MongoClient;
  secret: string;
  baseURL: string;
  disableSignUp?: boolean;
  /** Sign-in/sign-up rate limits. Better Auth enables them in production only by default. */
  rateLimit?: boolean;
  /** `nextCookies()` sets cookies from server actions; it needs a Next.js request scope. */
  nextJs?: boolean;
}

/** Better Auth with email/password on MongoDB. Collections are prefixed `auth_` (docs/03). */
export function createAuth(opts: CreateAuthOptions) {
  return betterAuth({
    secret: opts.secret,
    baseURL: opts.baseURL,
    database: mongodbAdapter(opts.db, { client: opts.client }),
    emailAndPassword: {
      enabled: true,
      disableSignUp: opts.disableSignUp ?? false,
      minPasswordLength: 8,
      maxPasswordLength: 128,
      autoSignIn: true,
    },
    user: { modelName: "auth_users" },
    session: { modelName: "auth_sessions" },
    account: { modelName: "auth_accounts" },
    verification: { modelName: "auth_verifications" },
    rateLimit: {
      enabled: opts.rateLimit,
      storage: "database",
      modelName: "auth_rate_limits",
      window: 60,
      max: 100,
      customRules: {
        "/sign-in/email": { window: 60, max: 5 },
        "/sign-up/email": { window: 60, max: 5 },
      },
    },
    // nextCookies must be the last plugin
    plugins: opts.nextJs === false ? [] : [nextCookies()],
  });
}

export type Auth = ReturnType<typeof createAuth>;

type AuthCache = { auth?: Auth; client?: MongoClient };
const globalCache = globalThis as typeof globalThis & { __wealthtrackAuth?: AuthCache };
const cache = (globalCache.__wealthtrackAuth ??= {});

/** The app's Better Auth instance (own lazily-connecting MongoClient, shared across hot reloads). */
export function getAuth(): Auth {
  if (!cache.auth) {
    const env = getEnv();
    cache.client ??= new MongoClient(env.MONGODB_URI);
    cache.auth = createAuth({
      db: cache.client.db(),
      client: cache.client,
      secret: env.BETTER_AUTH_SECRET,
      baseURL: env.BETTER_AUTH_URL,
      disableSignUp: env.DISABLE_SIGNUP,
      rateLimit: env.NODE_ENV === "production" && env.AUTH_RATE_LIMIT === "on",
    });
  }
  return cache.auth;
}
