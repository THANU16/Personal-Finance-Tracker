import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { totpCode } from "../helpers/totp";

// scripts/e2e-server.ts points MAIL_CAPTURE_FILE here (console mail driver).
const MAIL_FILE = path.join(os.tmpdir(), "wealthtrack-e2e-mail.jsonl");
const PASSWORD = "correct-horse-battery";

function field(page: Page, label: string, exact = false) {
  return page.getByLabel(label, { exact }).filter({ visible: true });
}

function uniqueEmail() {
  return `e2e-auth-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
}

async function register(page: Page, email: string) {
  await page.goto("/register");
  await field(page, "Name").fill("Nimal Perera");
  await field(page, "Email").fill(email);
  await field(page, "Password", true).fill(PASSWORD);
  await field(page, "Confirm password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/onboarding$/);
}

async function logOut(page: Page) {
  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("menuitem", { name: "Log out" }).click();
  await expect(page).toHaveURL(/\/login$/);
}

async function logIn(page: Page, email: string, password = PASSWORD) {
  await page.goto("/login");
  await field(page, "Email").fill(email);
  await field(page, "Password", true).fill(password);
  await page.getByRole("button", { name: "Log in" }).click();
}

/** Latest captured email to `to` (polls: sending happens on the server). */
async function lastLinkTo(to: string): Promise<string> {
  let link: string | undefined;
  await expect
    .poll(async () => {
      const raw = await readFile(MAIL_FILE, "utf8").catch(() => "");
      const mails = raw
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l) as { to: string; text: string })
        .filter((m) => m.to === to);
      link = mails.at(-1)?.text.match(/https?:\/\/\S+/)?.[0];
      return link;
    })
    .toBeTruthy();
  return link!;
}

async function openSecurityTab(page: Page) {
  await page.goto("/settings");
  await page.getByRole("tab", { name: "Security" }).click();
}

/** Enrols TOTP from the Security tab; returns the manual key and the backup codes shown once. */
async function enrolTwoFactor(page: Page) {
  await openSecurityTab(page);
  await page.getByRole("button", { name: "Turn on" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await dialog.getByRole("button", { name: "Continue" }).click();

  const key = ((await dialog.getByTestId("totp-manual-key").textContent()) ?? "").replace(
    /\s/g,
    "",
  );
  expect(key).toMatch(/^[A-Z2-7]+=*$/);
  await expect(dialog.getByRole("img", { name: /QR code/ })).toBeVisible();
  await dialog.getByLabel("Code from the app").fill(totpCode(key));
  await dialog.getByRole("button", { name: "Turn on" }).click();

  const items = dialog.getByRole("list", { name: "Backup codes" }).getByRole("listitem");
  await expect(items).toHaveCount(10);
  const codes = await items.allTextContents();
  await dialog.getByRole("button", { name: "I saved them" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "New backup codes" })).toBeVisible();
  return { key, codes };
}

test("forgot password → emailed link → new password → log in", async ({ page }) => {
  const email = uniqueEmail();
  await register(page, email);
  await logOut(page);

  await page.getByRole("link", { name: "Forgot password?" }).click();
  await expect(page).toHaveURL(/\/forgot-password$/);
  await field(page, "Email").fill(email);
  await page.getByRole("button", { name: "Send reset link" }).click();
  await expect(page.getByRole("status")).toContainText("If an account exists");

  // An unknown email gets exactly the same answer.
  await page.goto("/forgot-password");
  await field(page, "Email").fill(`nobody-${email}`);
  await page.getByRole("button", { name: "Send reset link" }).click();
  await expect(page.getByRole("status")).toContainText("If an account exists");

  await page.goto(await lastLinkTo(email));
  await expect(page).toHaveURL(/\/reset-password\?token=/);
  await field(page, "New password", true).fill("a-brand-new-password");
  await field(page, "Confirm new password").fill("a-brand-new-password");
  await page.getByRole("button", { name: "Set new password" }).click();
  await expect(page).toHaveURL(/\/login$/);

  await logIn(page, email);
  await expect(
    page.getByRole("alert").filter({ hasText: "Incorrect email or password." }),
  ).toBeVisible();
  await logIn(page, email, "a-brand-new-password");
  await expect(page).toHaveURL(/\/dashboard$/);
});

test("a used or bad reset link is rejected", async ({ page }) => {
  await page.goto("/reset-password?error=INVALID_TOKEN");
  await expect(page.getByRole("alert").filter({ hasText: "invalid or has expired" })).toBeVisible();
});

test("two-factor: enrol → log out → log in with an authenticator code", async ({ page }) => {
  const email = uniqueEmail();
  await register(page, email);
  const { key } = await enrolTwoFactor(page);
  await logOut(page);

  await logIn(page, email);
  await expect(page).toHaveURL(/\/two-factor/);
  await field(page, "Authentication code").fill("000000" === totpCode(key) ? "111111" : "000000");
  await page.getByRole("button", { name: "Verify" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "not valid" })).toBeVisible();

  await field(page, "Authentication code").fill(totpCode(key));
  await page.getByRole("button", { name: "Verify" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await openSecurityTab(page);
  await expect(page.getByRole("button", { name: "Turn off" })).toBeVisible();
});

test("two-factor: a backup code works exactly once", async ({ page }) => {
  const email = uniqueEmail();
  await register(page, email);
  const { codes } = await enrolTwoFactor(page);
  await logOut(page);

  const useBackupCode = async () => {
    await logIn(page, email);
    await expect(page).toHaveURL(/\/two-factor/);
    await page.getByRole("button", { name: "Use a backup code instead" }).click();
    await field(page, "Backup code").fill(codes[0]!);
    await page.getByRole("button", { name: "Verify" }).click();
  };

  await useBackupCode();
  await expect(page).toHaveURL(/\/dashboard$/);
  await logOut(page);

  await useBackupCode();
  await expect(page.getByRole("alert").filter({ hasText: "already used" })).toBeVisible();
  await expect(page).toHaveURL(/\/two-factor/);
});

test("security tab lists this device and signs out other devices", async ({ browser }) => {
  const email = uniqueEmail();
  const first = await browser.newContext();
  const second = await browser.newContext();
  const a = await first.newPage();
  const b = await second.newPage();
  await register(a, email);
  await logIn(b, email);
  await expect(b).toHaveURL(/\/dashboard$/);

  await openSecurityTab(a);
  await expect(a.getByText("This device")).toBeVisible();
  await a.getByRole("button", { name: "Sign out other devices" }).click();
  await a.getByRole("alertdialog").getByRole("button", { name: "Sign out others" }).click();
  await expect(a.getByText("Other devices signed out")).toBeVisible();

  await b.goto("/settings");
  await expect(b).toHaveURL(/\/login/);
  await first.close();
  await second.close();
});
