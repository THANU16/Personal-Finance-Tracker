import { expect, test, type Page } from "@playwright/test";

// Phase 10 — Essentials, Forecast, Notifications (+ the daily job through its route).
const PASSWORD = "correct-horse-battery";
const CRON_SECRET = "e2e-cron-secret-not-for-production"; // scripts/e2e-server.ts
const field = (page: Page, label: string, exact = false) =>
  page.getByLabel(label, { exact }).filter({ visible: true });

async function register(page: Page) {
  await page.goto("/register");
  await field(page, "Name").fill("Essentials Tester");
  await field(page, "Email").fill(
    `ess-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`,
  );
  await field(page, "Password", true).fill(PASSWORD);
  await field(page, "Confirm password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/onboarding$/);
}

test("essentials → policy → daily job → notification read and snooze; forecast horizons", async ({
  page,
}) => {
  await register(page);
  await page.goto("/accounts");
  await page.getByRole("button", { name: "Add account" }).first().click();
  const d = page.getByRole("dialog");
  await d.getByLabel("Name").fill("Bank");
  await d.getByLabel("Balance on opening date").fill("100000");
  await d.getByRole("button", { name: "Add account" }).click();
  await expect(page.getByText("Bank added")).toBeVisible();

  await page.goto("/essentials");
  await expect(page.getByRole("img", { name: /Health score \d+ of 100/ })).toBeVisible();
  await expect(page.getByText("Emergency fund", { exact: true }).first()).toBeVisible();

  // A policy renewing next month → insurance_renewal (30 days before).
  await page.getByRole("button", { name: "Add policy" }).click();
  const p = page.getByRole("dialog", { name: "Add policy" });
  await p.getByLabel("Provider").fill("AIA");
  await p.getByLabel("Cover").fill("5000000");
  await p.getByLabel("Premium").fill("60000");
  await field(page, "Renewal date", true).click();
  await page.getByRole("button", { name: /next month/i }).click();
  await page.getByRole("gridcell").filter({ hasText: /^1$/ }).first().click();
  await p.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Policy added")).toBeVisible();
  await expect(page.getByRole("cell", { name: /AIA/ })).toBeVisible();

  // The daily job: refused without the secret, idempotent with it.
  expect((await page.request.get("/api/cron/daily")).status()).toBe(401);
  const run = () =>
    page.request.get("/api/cron/daily", { headers: { authorization: `Bearer ${CRON_SECRET}` } });
  expect((await run()).ok()).toBe(true);
  expect((await run()).ok()).toBe(true);

  await page.goto("/notifications");
  const item = page.getByRole("link", { name: /AIA \(life\) renews/ });
  await expect(item).toHaveCount(1);
  await expect(page.getByRole("link", { name: /Notifications, 1 unread/ })).toBeVisible();
  await page.getByRole("button", { name: /Mark ".*AIA.*" read/ }).click();
  await expect(page.getByText("All read")).toBeVisible();
  await page.getByRole("button", { name: /Snooze ".*AIA.*"/ }).click();
  await page.getByRole("menuitem", { name: "3 days" }).click();
  await expect(page.getByText("No notifications")).toBeVisible();

  await page.goto("/forecast");
  await expect(page.getByText("Cash forecast")).toBeVisible();
  await expect(page.getByRole("cell", { name: "Bank" })).toBeVisible();
  await page.getByRole("link", { name: "90 days" }).click();
  await expect(page).toHaveURL(/days=90/);
  await expect(page.getByText("Net worth projection")).toBeVisible();
});
