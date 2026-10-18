import "server-only";
import { betterAuth } from "better-auth";
import { trustedOrigins } from "@/server/auth/origins";
import { mongodbAdapter } from "better-auth/adapters/mongodb";
import { nextCookies } from "better-auth/next-js";
import { twoFactor } from "better-auth/plugins";
import { MongoClient, type Db } from "mongodb";
import { getEnv } from "@/server/env";
import { getMailer, type Mailer } from "@/server/mail/mailer";
import { resetPasswordEmail, verifyEmailEmail } from "@/server/mail/templates";

export const APP_NAME = "WealthTrack";
export const RESET_TOKEN_TTL_SECONDS = 60 * 60;
export const VERIFY_TOKEN_TTL_SECONDS = 24 * 60 * 60;

export interface CreateAuthOptions {
  db: Db;
  client: MongoClient;
  secret: string;
  baseURL: string;
  /** Origins allowed to call the auth API besides baseURL (deployment URLs). */
  trustedOrigins?: string[];
  disableSignUp?: boolean;
  /** Sign-in/sign-up rate limits. Better Auth enables them in production only by default. */
  rateLimit?: boolean;
  /** `nextCookies()` sets cookies from server actions; it needs a Next.js request scope. */
  nextJs?: boolean;
  /** Users must confirm their email before logging in (REQUIRE_EMAIL_VERIFICATION). */
  requireEmailVerification?: boolean;
  /** Sends reset and verification emails. Defaults to the app mailer. */
  mailer?: Mailer;
}

/**
 * Better Auth with email/password on MongoDB. Collections are prefixed `auth_` (docs/03).
 * Password reset, optional email verification, TOTP two-factor with backup codes (MOD-1).
 * Two-factor secrets and backup codes are encrypted at rest by Better Auth with `secret`.
 */
export function createAuth(opts: CreateAuthOptions) {
  const mailer = () => opts.mailer ?? getMailer();
  const requireEmailVerification = opts.requireEmailVerification ?? false;
  return betterAuth({
    appName: APP_NAME,
    secret: opts.secret,
    baseURL: opts.baseURL,
    trustedOrigins: opts.trustedOrigins ?? [],
    database: mongodbAdapter(opts.db, { client: opts.client }),
    emailAndPassword: {
      enabled: true,
      disableSignUp: opts.disableSignUp ?? false,
      minPasswordLength: 8,
      maxPasswordLength: 128,
      autoSignIn: !requireEmailVerification,
      requireEmailVerification,
      resetPasswordTokenExpiresIn: RESET_TOKEN_TTL_SECONDS,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) => {
        await mailer().send(resetPasswordEmail(user, url));
      },
    },
    emailVerification: {
      sendOnSignUp: requireEmailVerification,
      autoSignInAfterVerification: true,
      expiresIn: VERIFY_TOKEN_TTL_SECONDS,
      sendVerificationEmail: async ({ user, url }) => {
        await mailer().send(verifyEmailEmail(user, url));
      },
    },
    user: { modelName: "auth_users" },
    // freshAge 0: listing sessions works on any session; sensitive actions still ask for the password.
    session: { modelName: "auth_sessions", freshAge: 0 },
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
        "/request-password-reset": { window: 60, max: 3 },
        "/send-verification-email": { window: 60, max: 3 },
        "/two-factor/*": { window: 60, max: 5 },
      },
    },
    plugins: [
      twoFactor({
        issuer: APP_NAME,
        twoFactorTable: "auth_two_factors",
        backupCodeOptions: { amount: 10, length: 10, storeBackupCodes: "encrypted" },
        accountLockout: { enabled: true, maxFailedAttempts: 5, durationSeconds: 15 * 60 },
      }),
      // nextCookies must be the last plugin
      ...(opts.nextJs === false ? [] : [nextCookies()]),
    ],
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
      trustedOrigins: trustedOrigins({ ...process.env, ...env }),
      disableSignUp: env.DISABLE_SIGNUP,
      requireEmailVerification: env.REQUIRE_EMAIL_VERIFICATION,
      rateLimit: env.NODE_ENV === "production" && env.AUTH_RATE_LIMIT === "on",
    });
  }
  return cache.auth;
}
