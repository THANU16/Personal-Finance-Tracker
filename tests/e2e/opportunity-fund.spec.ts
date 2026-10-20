import { expect, test, type Page } from "@playwright/test";

const PASSWORD = "correct-horse-battery";
const field = (page: Page, label: string, exact = false) =>
  page.getByLabel(label, { exact }).filter({ visible: true });

async function register(page: Page) {
  await page.goto("/register");
  await field(page, "Name").fill("Opportunity Tester");
  await field(page, "Email").fill(
    `opp-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`,
  );
  await field(page, "Password", true).fill(PASSWORD);
  await field(page, "Confirm password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/onboarding$/);
}

test("earmark → levels → banner → deploy 50,000 → earmark 150,000 → undo", async ({ page }) => {
  await register(page);

  // Commercial Bank 350,000 with 200,000 opportunity money.
  await page.goto("/accounts");
  await page.getByRole("button", { name: "Add account" }).first().click();
  const d = page.getByRole("dialog");
  await d.getByLabel("Name").fill("Commercial Bank");
  await d.getByLabel("Balance on opening date").fill("350000");
  await d.getByRole("button", { name: "Add account" }).click();
  await expect(page.getByText("Commercial Bank added")).toBeVisible();
  await page.getByRole("button", { name: "Actions for Commercial Bank" }).click();
  await page.getByRole("menuitem", { name: "Earmark / move" }).click();
  const em = page.getByRole("dialog");
  await em.getByRole("radio", { name: "Opportunity" }).click();
  await em.getByLabel("Amount", { exact: true }).fill("200000");
  await em.getByRole("button", { name: "Save earmark" }).click();
  await expect(page.getByText("Earmark saved")).toBeVisible();

  // One equity holding as the whole target allocation.
  await page.goto("/assets");
  await page.getByRole("button", { name: "Add your first holding" }).click();
  const wizard = page.getByRole("dialog");
  await wizard.getByRole("radio", { name: "Equity" }).click();
  await wizard.getByRole("button", { name: "Next" }).click();
  await wizard.getByRole("radio", { name: "Unit trust" }).click();
  await wizard.getByRole("button", { name: "Next" }).click();
  await wizard.getByLabel("Name").fill("Fund A");
  await wizard.getByRole("button", { name: "Next" }).click();
  await wizard.getByLabel("Amount invested").fill("10000");
  await wizard.getByLabel("Current value").fill("10000");
  await wizard.getByRole("button", { name: "Add holding" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Fund A" })).toBeVisible();

  await page.goto("/rebalancing");
  await page.getByRole("button", { name: "Save target" }).waitFor();
  await page.getByRole("combobox", { name: "Add an asset class" }).click();
  await page.getByRole("option", { name: "Equity" }).click();
  await page.getByRole("combobox", { name: "Add a holding to Equity" }).click();
  await page.getByRole("option", { name: "Fund A" }).click();
  await field(page, "Equity percent").fill("100");
  await field(page, "Fund A percent of class").fill("100");
  await page.getByRole("button", { name: "Save target" }).click();
  await expect(page.getByText("Target allocation saved")).toBeVisible();

  // Levels: a high last month, then −11% today → rule −10% (25% of 200,000).
  await page.goto("/opportunity-fund");
  await expect(page.getByRole("heading", { level: 1, name: "Opportunity Fund" })).toBeVisible();
  await field(page, "Date", true).click();
  await page.getByRole("button", { name: /previous month/i }).click();
  await page.getByRole("gridcell").filter({ hasText: /^1$/ }).first().click();
  await field(page, "ASPI level").fill("12000");
  await page.getByRole("button", { name: "Add level" }).click();
  await expect(page.getByText("Level saved")).toBeVisible();
  await expect(page.getByText("12,000").first()).toBeVisible();
  await field(page, "ASPI level").fill("10680");
  await page.getByRole("button", { name: "Add level" }).click();

  const banner = page.getByRole("status").filter({ hasText: "Market drop detected" });
  await expect(banner).toContainText("rule −10.0% reached");
  await expect(banner).toContainText("LKR 50,000.00");

  await banner.getByRole("button", { name: "Record deployment" }).click();
  const dialog = page.getByRole("dialog", { name: "Record deployment" });
  await dialog.getByRole("button", { name: "Split by allocation" }).click();
  await expect(dialog.getByText("Leaves Commercial Bank:")).toContainText("LKR 50,000.00");
  await dialog.getByRole("button", { name: "Record deployment" }).click();
  await expect(page.getByText("Deployment recorded")).toBeVisible();

  await expect(page.getByText("Market drop detected")).toHaveCount(0);
  await expect(page.getByText("LKR 150,000.00").first()).toBeVisible(); // fund balance
  const row = page.getByRole("row").filter({ hasText: "Commercial Bank" });
  await expect(row).toContainText("Fund A");

  await page.goto("/accounts");
  await expect(page.getByRole("img", { name: /Opportunity LKR 150,000\.00/ })).toBeVisible();

  // Undo returns the money and the earmark.
  await page.goto("/opportunity-fund");
  await page.getByRole("button", { name: "Undo" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Undo deployment" }).click();
  await expect(page.getByText("Deployment undone")).toBeVisible();
  await expect(page.getByText("Undone", { exact: true })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "Market drop detected" })).toBeVisible();
});
