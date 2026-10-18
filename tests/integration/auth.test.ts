import { MongoClient } from "mongodb";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAuth, type Auth } from "@/server/auth/auth";
import { setupTestDb } from "../helpers/test-db";

const testDb = setupTestDb("wealthtrack-auth-test");

let client: MongoClient;
let auth: Auth;

const base = {
  secret: "test-secret-test-secret-test-secret-123",
  baseURL: "http://localhost:3100",
  nextJs: false,
};

beforeAll(async () => {
  client = new MongoClient(testDb.uri());
  await client.connect();
  auth = createAuth({ ...base, db: client.db(), client });
});

afterAll(async () => {
  await client?.close();
});

const credentials = {
  name: "Nimal Perera",
  email: "nimal@example.com",
  password: "correct-horse-1",
};

function cookieFrom(res: Response): string {
  return res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
}

describe("email/password auth", () => {
  it("signs up, signs in and resolves the session from the cookie", async () => {
    const signUp = await auth.api.signUpEmail({ body: credentials });
    expect(signUp.user.email).toBe(credentials.email);
    expect(signUp.user.id).toMatch(/^[a-f0-9]{24}$/); // ObjectId string, stored as settings.userId

    const res = await auth.api.signInEmail({
      body: { email: credentials.email, password: credentials.password },
      asResponse: true,
    });
    expect(res.status).toBe(200);
    const session = await auth.api.getSession({
      headers: new Headers({ cookie: cookieFrom(res) }),
    });
    expect(session?.user.email).toBe(credentials.email);
  });

  it("stores users and sessions in auth_-prefixed collections", async () => {
    const names = (await client.db().listCollections().toArray()).map((c) => c.name);
    expect(names).toEqual(expect.arrayContaining(["auth_users", "auth_sessions", "auth_accounts"]));
  });

  it("rejects a wrong password", async () => {
    await auth.api.signUpEmail({ body: { ...credentials, email: "wrong@example.com" } });
    const res = await auth.api.signInEmail({
      body: { email: "wrong@example.com", password: "not-the-password" },
      asResponse: true,
    });
    expect(res.status).toBe(401);
  });

  it("rejects a duplicate email", async () => {
    await auth.api.signUpEmail({ body: { ...credentials, email: "dupe@example.com" } });
    await expect(
      auth.api.signUpEmail({ body: { ...credentials, email: "dupe@example.com" } }),
    ).rejects.toThrow();
  });

  it("rejects a short password", async () => {
    await expect(
      auth.api.signUpEmail({
        body: { ...credentials, email: "short@example.com", password: "short" },
      }),
    ).rejects.toThrow();
  });

  it("has no session without a cookie", async () => {
    expect(await auth.api.getSession({ headers: new Headers() })).toBeNull();
  });

  it("blocks sign-up when DISABLE_SIGNUP is on", async () => {
    const closed = createAuth({ ...base, db: client.db(), client, disableSignUp: true });
    await expect(
      closed.api.signUpEmail({ body: { ...credentials, email: "closed@example.com" } }),
    ).rejects.toThrow();
  });
});
