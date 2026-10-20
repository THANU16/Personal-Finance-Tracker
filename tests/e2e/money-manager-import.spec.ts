import { expect, test, type Page } from "@playwright/test";
import { fixtureRows2025, moneyManagerXlsx } from "../helpers/money-manager-fixture";

const PASSWORD = "correct-horse-battery";
const field = (page: Page, label: string, exact = false) =>
  page.getByLabel(label, { exact }).filter({ visible: true });

async function register(page: Page) {
  await page.goto("/register");
  await field(page, "Name").fill("Import Tester");
  await field(page, "Email").fill(
    `mm-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`,
  );
  await field(page, "Password", true).fill(PASSWORD);
  await field(page, "Confirm password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/onboarding$/);
}

test("Money Manager: upload → map existing + new → preview → import → undo", async ({ page }) => {
  await register(page);

  // An existing account the file's "Sampath Bank" maps to (opened today, so its opening date moves).
  await page.goto("/accounts");
  await page.getByRole("button", { name: "Add account" }).first().click();
  const d = page.getByRole("dialog");
  await d.getByLabel("Name").fill("Sampath Bank");
  await d.getByLabel("Balance on opening date").fill("100000");
  await d.getByRole("button", { name: "Add account" }).click();
  await expect(page.getByText("Sampath Bank added")).toBeVisible();

  // 1 Upload (entry from Transactions → Import)
  await page.goto("/transactions");
  await page.getByRole("link", { name: "Import" }).click();
  await expect(page).toHaveURL(/\/transactions\/import$/);
  await page.getByLabel("Money Manager export (.xlsx)").setInputFiles({
    name: "2025.xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: await moneyManagerXlsx(fixtureRows2025()),
  });
  await page.getByRole("button", { name: "Upload and continue" }).click();
  await expect(page).toHaveURL(/\/transactions\/import\/money-manager\/[a-f0-9]{24}$/);

  // 2 Accounts: Sampath Bank → existing account; the rest are suggested as new accounts/holdings.
  await expect(page.getByRole("heading", { name: "Accounts" })).toBeVisible();
  const sampath = page.getByTestId("mm-account-sampath bank");
  await expect(sampath.getByText("Ready")).toBeVisible();
  await expect(page.getByText("7 of 7 ready")).toBeVisible();
  await page.getByRole("button", { name: "Next" }).click();

  // 3 Expense and 4 income categories: defaults (match or create) are complete.
  await expect(page.getByRole("heading", { name: "Expense categories" })).toBeVisible();
  await expect(page.getByText(/“Petrol” looks like “Bike › Petrol”/)).toBeVisible();
  await page.getByRole("button", { name: "Merge" }).first().click();
  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.getByRole("heading", { name: "Income categories" })).toBeVisible();
  await page.getByRole("button", { name: "Next" }).click();

  // 5 Special rows
  await expect(page.getByRole("heading", { name: "Review special rows" })).toBeVisible();
  await expect(page.locator("summary", { hasText: "Transfers" })).toContainText("7");
  await page.getByRole("button", { name: "Next" }).click();

  // 6 Openings: the existing account's history starts earlier → move its opening date.
  await expect(page.getByRole("heading", { name: "Opening balances" })).toBeVisible();
  await page.getByRole("checkbox", { name: /Move its opening date to 2025-01-01/ }).click();
  await page.getByRole("button", { name: "Next" }).click();

  // 7 Preview: every balance matches Money Manager
  await expect(page.getByRole("heading", { name: "Preview" })).toBeVisible();
  await expect(
    page.getByText("Every account will match Money Manager’s own balance."),
  ).toBeVisible();
  await page.getByRole("checkbox", { name: "I reviewed the mapping" }).click();
  await page.getByRole("button", { name: "Import", exact: true }).click();

  // 8 Result
  await expect(page.getByRole("heading", { name: "Import complete" })).toBeVisible();
  await page.goto("/accounts");
  await expect(page.getByText("Cash In Hand").first()).toBeVisible();

  // Undo from the history list
  await page.goto("/transactions/import");
  await page.getByRole("link", { name: "View" }).first().click();
  await page.getByRole("button", { name: "Undo this import" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Undo import" }).click();
  await expect(page.getByRole("heading", { name: "Import undone" })).toBeVisible();
});
