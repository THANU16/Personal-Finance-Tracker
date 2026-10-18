import { describe, expect, it } from "vitest";
import {
  PUBLIC_AUTH_PATHS,
  backupCodeSchema,
  resetPasswordSchema,
  totpCodeSchema,
} from "@/lib/auth-schemas";

describe("totpCodeSchema", () => {
  it.each([
    ["123456", "123456"],
    ["123 456", "123456"],
    ["123-456", "123456"],
    [" 012345 ", "012345"],
  ])("accepts %j", (input, code) => {
    expect(totpCodeSchema.parse({ code: input })).toEqual({ code });
  });

  it.each(["12345", "1234567", "abcdef", ""])("rejects %j", (input) => {
    expect(totpCodeSchema.safeParse({ code: input }).success).toBe(false);
  });
});

describe("backupCodeSchema", () => {
  it("trims and requires a code", () => {
    expect(backupCodeSchema.parse({ code: "  AbC12-dEf34 " })).toEqual({ code: "AbC12-dEf34" });
    expect(backupCodeSchema.safeParse({ code: " " }).success).toBe(false);
  });
});

describe("resetPasswordSchema", () => {
  it("needs matching passwords of at least 8 characters", () => {
    expect(
      resetPasswordSchema.safeParse({ newPassword: "long-enough", confirmPassword: "long-enough" })
        .success,
    ).toBe(true);
    expect(
      resetPasswordSchema.safeParse({ newPassword: "long-enough", confirmPassword: "different" })
        .success,
    ).toBe(false);
    expect(
      resetPasswordSchema.safeParse({ newPassword: "short", confirmPassword: "short" }).success,
    ).toBe(false);
  });
});

it("every auth page is public", () => {
  expect(PUBLIC_AUTH_PATHS).toEqual([
    "/login",
    "/register",
    "/forgot-password",
    "/reset-password",
    "/verify-email",
    "/two-factor",
  ]);
});
