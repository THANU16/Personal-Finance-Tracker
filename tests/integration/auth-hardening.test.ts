import { MongoClient } from "mongodb";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createAuth, type Auth, type CreateAuthOptions } from "@/server/auth/auth";
import { resetPasswordOffline } from "@/server/auth/offline-reset";
import type { Mailer, MailMessage } from "@/server/mail/mailer";
import { setupTestDb } from "../helpers/test-db";
import { secretFromTotpUri, totpCode } from "../helpers/totp";

const testDb = setupTestDb("wealthtrack-auth-hardening-test");

const BASE_URL = "http://localhost:3100";
const outbox: MailMessage[] = [];
const mailer: Mailer = {
  driver: "console",
  send: async (m) => {
    outbox.push(m);
  },
};

let client: MongoClient;
let auth: Auth;

function makeAuth(extra: Partial<CreateAuthOptions> = {}) {
  return createAuth({
    db: client.db(),
    client,
    secret: "test-secret-test-secret-test-secret-123",
    baseURL: BASE_URL,
    nextJs: false,
    mailer,
    ...extra,
  });
}

beforeAll(async () => {
  client = new MongoClient(testDb.uri());
  await client.connect();
  auth = makeAuth();
});

afterAll(async () => {
  await client?.close();
});

beforeEach(() => {
  outbox.length = 0;
});

const PASSWORD = "correct-horse-1";
let n = 0;
const nextEmail = () => `user${++n}@example.com`;

function cookieFrom(res: Response): string {
  return res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
}

/** Merges the Set-Cookie headers of `res` into a cookie header. */
function mergeCookies(current: string, res: Response): string {
  const jar = new Map<string, string>();
  for (const pair of current.split("; ").filter(Boolean)) {
    jar.set(pair.slice(0, pair.indexOf("=")), pair);
  }
  for (const c of res.headers.getSetCookie()) {
    const pair = c.split(";")[0]!;
    jar.set(pair.slice(0, pair.indexOf("=")), pair);
  }
  return [...jar.values()].join("; ");
}

async function signUp(a: Auth, email = nextEmail()) {
  await a.api.signUpEmail({ body: { name: "Nimal Perera", email, password: PASSWORD } });
  return email;
}

function signIn(a: Auth, email: string, password = PASSWORD) {
  return a.api.signInEmail({ body: { email, password }, asResponse: true });
}

async function sessionCookie(a: Auth, email: string): Promise<string> {
  const res = await signIn(a, email);
  expect(res.status).toBe(200);
  return cookieFrom(res);
}

function linkIn(message: MailMessage): string {
  const match = /https?:\/\/\S+/.exec(message.text);
  if (!match) throw new Error("no link in email");
  return match[0];
}

/** reset: /api/auth/reset-password/<token>; verify: ?token=<token> */
function tokenFromUrl(url: string): string {
  const u = new URL(url);
  return u.searchParams.get("token") ?? u.pathname.split("/").pop()!;
}

async function twoFactorRedirect(res: Response): Promise<boolean> {
  const body = (await res.json()) as { twoFactorRedirect?: boolean };
  return body.twoFactorRedirect === true;
}

describe("password reset", () => {
  it("emails a link whose token sets a new password and signs out every session", async () => {
    const email = await signUp(auth);
    const cookie = await sessionCookie(auth, email);

    await auth.api.requestPasswordReset({ body: { email, redirectTo: "/reset-password" } });
    expect(outbox).toHaveLength(1);
    expect(outbox[0]!.to).toBe(email);
    const url = linkIn(outbox[0]!);
    expect(url.startsWith(`${BASE_URL}/api/auth/reset-password/`)).toBe(true);

    await auth.api.resetPassword({
      body: { newPassword: "brand-new-pass-2", token: tokenFromUrl(url) },
    });
    expect((await signIn(auth, email)).status).toBe(401);
    expect((await signIn(auth, email, "brand-new-pass-2")).status).toBe(200);
    expect(await auth.api.getSession({ headers: new Headers({ cookie }) })).toBeNull();
  });

  it("answers the same for an unknown email and sends nothing", async () => {
    const known = await signUp(auth);
    const a = await auth.api.requestPasswordReset({ body: { email: known } });
    const b = await auth.api.requestPasswordReset({ body: { email: "nobody@example.com" } });
    expect(b).toEqual(a);
    expect(outbox.map((m) => m.to)).toEqual([known]);
  });

  it("rejects an invalid token", async () => {
    await expect(
      auth.api.resetPassword({ body: { newPassword: "brand-new-pass-2", token: "nope" } }),
    ).rejects.toThrow();
  });
});

describe("offline reset (scripts/reset-password.ts)", () => {
  it("hashes the new password with Better Auth and revokes sessions", async () => {
    const email = await signUp(auth);
    const cookie = await sessionCookie(auth, email);
    await resetPasswordOffline(auth, email.toUpperCase(), "offline-pass-3");
    expect((await signIn(auth, email, "offline-pass-3")).status).toBe(200);
    expect(await auth.api.getSession({ headers: new Headers({ cookie }) })).toBeNull();
    const accounts = await client
      .db()
      .collection("auth_accounts")
      .find({ providerId: "credential" })
      .toArray();
    expect(JSON.stringify(accounts)).not.toContain("offline-pass-3");
  });

  it("rejects unknown users and bad lengths", async () => {
    await expect(resetPasswordOffline(auth, "ghost@example.com", "long-enough-1")).rejects.toThrow(
      /No user/,
    );
    const email = await signUp(auth);
    await expect(resetPasswordOffline(auth, email, "short")).rejects.toThrow(/characters/);
  });
});

describe("email verification (REQUIRE_EMAIL_VERIFICATION)", () => {
  it("blocks login until the emailed link is used", async () => {
    const strict = makeAuth({ requireEmailVerification: true });
    const email = nextEmail();
    await strict.api.signUpEmail({
      body: { name: "Nimal", email, password: PASSWORD, callbackURL: "/verify-email?verified=1" },
    });
    expect(outbox).toHaveLength(1);
    const res = await signIn(strict, email);
    expect(res.status).toBe(403);
    expect(((await res.json()) as { code?: string }).code).toBe("EMAIL_NOT_VERIFIED");

    await strict.api.verifyEmail({ query: { token: tokenFromUrl(linkIn(outbox[0]!)) } });
    expect((await signIn(strict, email)).status).toBe(200);
  });

  it("is off by default: sign-up sends no email and login works", async () => {
    const email = await signUp(auth);
    expect(outbox).toHaveLength(0);
    expect((await signIn(auth, email)).status).toBe(200);
  });
});

describe("session lifetime (docs/07 §7)", () => {
  it("a new session lasts 30 days", async () => {
    const email = await signUp(auth);
    const headers = new Headers({ cookie: await sessionCookie(auth, email) });
    const session = await auth.api.getSession({ headers });
    const days = (session!.session.expiresAt.getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(29.9);
    expect(days).toBeLessThanOrEqual(30);
  });
});

async function enrol(email: string) {
  const headers = new Headers({ cookie: await sessionCookie(auth, email) });
  const enabled = await auth.api.enableTwoFactor({
    body: { password: PASSWORD, method: "totp" },
    headers,
  });
  if (enabled.method !== "totp") throw new Error("expected TOTP enrolment");
  return { headers, key: secretFromTotpUri(enabled.totpURI), backupCodes: enabled.backupCodes };
}

async function enrolAndConfirm(email: string) {
  const enrolled = await enrol(email);
  await auth.api.verifyTOTP({ body: { code: totpCode(enrolled.key) }, headers: enrolled.headers });
  return enrolled;
}

/** Password step of a 2FA login; returns the pending two-factor cookie. */
async function startTwoFactorLogin(email: string): Promise<string> {
  const res = await signIn(auth, email);
  expect(res.status).toBe(200);
  const cookie = cookieFrom(res);
  expect(await twoFactorRedirect(res)).toBe(true);
  return cookie;
}

async function signInWithCode(email: string, key: string): Promise<string> {
  const pending = await startTwoFactorLogin(email);
  const ok = await auth.api.verifyTOTP({
    body: { code: totpCode(key) },
    headers: new Headers({ cookie: pending }),
    asResponse: true,
  });
  expect(ok.status).toBe(200);
  return mergeCookies(pending, ok);
}

describe("two-factor (TOTP + backup codes)", () => {
  it("is not active until the first code is confirmed", async () => {
    const email = await signUp(auth);
    const { headers, key } = await enrol(email);
    expect(await twoFactorRedirect(await signIn(auth, email))).toBe(false);

    await auth.api.verifyTOTP({ body: { code: totpCode(key) }, headers });
    const user = await client.db().collection("auth_users").findOne({ email });
    expect(user?.twoFactorEnabled).toBe(true);
    expect(await twoFactorRedirect(await signIn(auth, email))).toBe(true);
  });

  it("stores the secret and backup codes encrypted, not in plain text", async () => {
    const email = await signUp(auth);
    const { key, backupCodes } = await enrol(email);
    const rows = await client.db().collection("auth_two_factors").find({}).toArray();
    expect(rows).toHaveLength(1);
    const raw = JSON.stringify(rows);
    expect(raw).not.toContain(key);
    for (const code of backupCodes) expect(raw).not.toContain(code);
  });

  it("asks for a code after the password; a wrong code fails and a valid one logs in", async () => {
    const email = await signUp(auth);
    const { key } = await enrolAndConfirm(email);

    const pending = await startTwoFactorLogin(email);
    expect(await auth.api.getSession({ headers: new Headers({ cookie: pending }) })).toBeNull();

    const valid = totpCode(key);
    const bad = await auth.api.verifyTOTP({
      body: { code: valid === "000000" ? "111111" : "000000" },
      headers: new Headers({ cookie: pending }),
      asResponse: true,
    });
    expect(bad.status).toBeGreaterThanOrEqual(400);

    const ok = await auth.api.verifyTOTP({
      body: { code: valid },
      headers: new Headers({ cookie: pending }),
      asResponse: true,
    });
    expect(ok.status).toBe(200);
    const session = await auth.api.getSession({
      headers: new Headers({ cookie: mergeCookies(pending, ok) }),
    });
    expect(session?.user.email).toBe(email);
  });

  it("a backup code works once", async () => {
    const email = await signUp(auth);
    const { backupCodes } = await enrolAndConfirm(email);
    const code = backupCodes[0]!;

    const first = await auth.api.verifyBackupCode({
      body: { code },
      headers: new Headers({ cookie: await startTwoFactorLogin(email) }),
      asResponse: true,
    });
    expect(first.status).toBe(200);

    const reused = await auth.api.verifyBackupCode({
      body: { code },
      headers: new Headers({ cookie: await startTwoFactorLogin(email) }),
      asResponse: true,
    });
    expect(reused.status).toBeGreaterThanOrEqual(400);
  });

  it("regenerating codes and disabling need the password", async () => {
    const email = await signUp(auth);
    const { key, backupCodes } = await enrolAndConfirm(email);
    const headers = new Headers({ cookie: await signInWithCode(email, key) });

    await expect(
      auth.api.generateBackupCodes({ body: { password: "wrong-password" }, headers }),
    ).rejects.toThrow();
    const regenerated = await auth.api.generateBackupCodes({
      body: { password: PASSWORD },
      headers,
    });
    expect(regenerated.backupCodes).toHaveLength(10);
    expect(regenerated.backupCodes).not.toContain(backupCodes[0]);

    await expect(
      auth.api.disableTwoFactor({ body: { password: "wrong-password" }, headers }),
    ).rejects.toThrow();
    await auth.api.disableTwoFactor({ body: { password: PASSWORD }, headers });
    expect(await twoFactorRedirect(await signIn(auth, email))).toBe(false);
  });
});

describe("sessions", () => {
  it("lists sessions and signs out the other devices", async () => {
    const email = await signUp(auth);
    const laptop = await sessionCookie(auth, email);
    const phone = await sessionCookie(auth, email);
    const headers = new Headers({ cookie: laptop });

    // sign-up signs in too: three sessions
    expect(await auth.api.listSessions({ headers })).toHaveLength(3);

    await auth.api.revokeOtherSessions({ headers });
    expect(await auth.api.getSession({ headers: new Headers({ cookie: phone }) })).toBeNull();
    expect((await auth.api.getSession({ headers }))?.user.email).toBe(email);
    expect(await auth.api.listSessions({ headers })).toHaveLength(1);
  });
});
