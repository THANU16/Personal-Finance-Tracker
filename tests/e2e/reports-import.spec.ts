import { expect, test, type Page } from "@playwright/test";

// Phase 11 — bank CSV import (re-import adds nothing), reports tabs + CSV, backup download,
// attachments upload.
const PASSWORD = "correct-horse-battery";
const field = (page: Page, label: string, exact = false) =>
  page.getByLabel(label, { exact }).filter({ visible: true });

async function register(page: Page) {
  await page.goto("/register");
  await field(page, "Name").fill("Reports Tester");
  await field(page, "Email").fill(
    `rep-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`,
  );
  await field(page, "Password", true).fill(PASSWORD);
  await field(page, "Confirm password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/onboarding$/);
}

// Today in the app's timezone (the account opens today; imports can't predate it).
const TODAY = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Colombo" }).format(new Date());
const MONTH = TODAY.slice(0, 7);
const CSV = [
  "Date,Description,Amount",
  `${TODAY},Keells Super,-1500.00`,
  `${TODAY},Salary,100000.00`,
].join("\n");

test("bank CSV import → re-import adds 0 → reports and exports", async ({ page }) => {
  await register(page);
  await page.goto("/accounts");
  await page.getByRole("button", { name: "Add account" }).first().click();
  const d = page.getByRole("dialog");
  await d.getByLabel("Name").fill("Bank");
  await d.getByLabel("Balance on opening date").fill("10000");
  await d.getByRole("button", { name: "Add account" }).click();
  await expect(page.getByText("Bank added")).toBeVisible();

  const upload = async () => {
    // Arrive through the link (a hydrated page) so the file input's change handler is attached.
    await page.goto("/transactions");
    await page.getByRole("link", { name: "Import" }).click();
    await expect(page).toHaveURL(/\/transactions\/import$/);
    await page.getByLabel("Statement file (.csv)").setInputFiles({
      name: "jan.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(CSV),
    });
    await expect(page.getByText("jan.csv")).toBeVisible();
  };
  await upload();
  await field(page, "Import into", true).click();
  await page.getByRole("option", { name: /^Bank/ }).click();
  await page.getByRole("button", { name: "Preview" }).click();
  await expect(page.getByText("2 new")).toBeVisible();
  await page.getByRole("button", { name: /Import 2 transactions/ }).click();
  await expect(page.getByText("2 transactions imported").first()).toBeVisible();

  // Same file again: the account and mapping are remembered; nothing new.
  await upload();
  await page.getByRole("button", { name: "Preview" }).click();
  await expect(page.getByText("0 new")).toBeVisible();
  await expect(page.getByRole("button", { name: /Import 0 transactions/ })).toBeDisabled();

  await page.goto(`/reports?tab=categories&from=${MONTH}&to=${MONTH}`);
  await expect(page.getByRole("link", { name: "Uncategorised" })).toBeVisible();
  const csv = await page.request.get(
    `/api/export?kind=report&report=categories&from=${MONTH}&to=${MONTH}`,
  );
  expect(csv.ok()).toBe(true);
  expect(await csv.text()).toContain("Uncategorised");
  const backup = await page.request.get("/api/export?kind=backup");
  expect(JSON.parse(await backup.text())).toMatchObject({ format: "wealthtrack-backup" });

  // Monthly summary (owner request): income and expense categories, each with a donut.
  await page.goto(`/reports?tab=monthly&month=${MONTH}`);
  const expenses = page.getByRole("table", { name: "Expenses by category" });
  const income = page.getByRole("table", { name: "Income by category" });
  await expect(expenses.getByText("Uncategorised")).toBeVisible();
  await expect(income.getByText("Uncategorised")).toBeVisible();
  await expect(page.getByRole("figure", { name: /^Income by category/ })).toBeVisible();
  if (process.env.E2E_SHOTS)
    await page.screenshot({ path: `${process.env.E2E_SHOTS}/monthly.png`, fullPage: true });

  await page.goto("/reports?tab=net-worth");
  await expect(page.getByRole("link", { name: "Export CSV" })).toBeVisible();
});
