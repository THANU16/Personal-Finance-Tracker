import { describe, expect, it } from "vitest";
import { parseEnv } from "@/server/env";

const valid = {
  MONGODB_URI: "mongodb+srv://user:pass@cluster0.example.mongodb.net/wealthtrack",
  BETTER_AUTH_SECRET: "x".repeat(32),
  BETTER_AUTH_URL: "http://localhost:3000",
  APP_URL: "http://localhost:3000",
  CRON_SECRET: "c".repeat(16),
};

describe("parseEnv", () => {
  it("accepts a minimal valid env and applies defaults", () => {
    const env = parseEnv(valid);
    expect(env.DEFAULT_TIMEZONE).toBe("Asia/Colombo");
    expect(env.DEFAULT_CURRENCY).toBe("LKR");
    expect(env.STORAGE_DRIVER).toBe("local");
    expect(env.NODE_ENV).toBe("development");
  });

  it.each([
    ["mongodb://localhost:27017/wealthtrack?replicaSet=rs0"],
    ["mongodb+srv://u:p@cluster0.example.mongodb.net/wealthtrack?retryWrites=true"],
  ])("accepts MONGODB_URI %s", (uri) => {
    expect(parseEnv({ ...valid, MONGODB_URI: uri }).MONGODB_URI).toBe(uri);
  });

  it.each([
    ["missing MONGODB_URI", { MONGODB_URI: undefined }, "MONGODB_URI"],
    ["non-mongo URI", { MONGODB_URI: "postgres://localhost/db" }, "MONGODB_URI"],
    ["short auth secret", { BETTER_AUTH_SECRET: "short" }, "BETTER_AUTH_SECRET"],
    ["invalid APP_URL", { APP_URL: "not a url" }, "APP_URL"],
    ["short cron secret", { CRON_SECRET: "abc" }, "CRON_SECRET"],
    ["lowercase currency", { DEFAULT_CURRENCY: "lkr" }, "DEFAULT_CURRENCY"],
    ["unknown storage driver", { STORAGE_DRIVER: "ftp" }, "STORAGE_DRIVER"],
  ])("rejects %s", (_label, override, key) => {
    expect(() => parseEnv({ ...valid, ...override })).toThrow(key);
  });

  it("parses REQUIRE_EMAIL_VERIFICATION (default off) and MAIL_CAPTURE_FILE", () => {
    expect(parseEnv(valid).REQUIRE_EMAIL_VERIFICATION).toBe(false);
    expect(
      parseEnv({ ...valid, REQUIRE_EMAIL_VERIFICATION: "true" }).REQUIRE_EMAIL_VERIFICATION,
    ).toBe(true);
    expect(() => parseEnv({ ...valid, REQUIRE_EMAIL_VERIFICATION: "yes" })).toThrow(
      "REQUIRE_EMAIL_VERIFICATION",
    );
    expect(parseEnv({ ...valid, MAIL_CAPTURE_FILE: "" }).MAIL_CAPTURE_FILE).toBeUndefined();
  });

  it("treats empty optional values as unset", () => {
    const env = parseEnv({ ...valid, RESEND_API_KEY: "", MAIL_FROM: "" });
    expect(env.RESEND_API_KEY).toBeUndefined();
    expect(env.MAIL_FROM).toBeUndefined();
  });

  it("requires S3 settings when STORAGE_DRIVER=s3", () => {
    expect(() => parseEnv({ ...valid, STORAGE_DRIVER: "s3" })).toThrow(/S3_BUCKET: required/);
    const env = parseEnv({
      ...valid,
      STORAGE_DRIVER: "s3",
      S3_REGION: "auto",
      S3_BUCKET: "receipts",
      S3_ACCESS_KEY_ID: "id",
      S3_SECRET_ACCESS_KEY: "secret",
    });
    expect(env.S3_BUCKET).toBe("receipts");
  });

  it.each([
    [undefined, false],
    ["", false],
    ["false", false],
    ["true", true],
  ])("parses DISABLE_SIGNUP=%j as %s", (value, expected) => {
    expect(parseEnv({ ...valid, DISABLE_SIGNUP: value }).DISABLE_SIGNUP).toBe(expected);
  });

  it("rejects a non-boolean DISABLE_SIGNUP", () => {
    expect(() => parseEnv({ ...valid, DISABLE_SIGNUP: "yes" })).toThrow("DISABLE_SIGNUP");
  });

  it("requires MAIL_FROM when RESEND_API_KEY is set", () => {
    expect(() => parseEnv({ ...valid, RESEND_API_KEY: "re_123" })).toThrow("MAIL_FROM");
  });

  it("never echoes secret values in the error", () => {
    const secret = "super-secret-but-too-short";
    expect.assertions(2);
    try {
      parseEnv({ ...valid, BETTER_AUTH_SECRET: secret });
    } catch (err) {
      expect(String(err)).toContain("BETTER_AUTH_SECRET");
      expect(String(err)).not.toContain(secret);
    }
  });
});
