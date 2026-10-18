import { expect, test, type Page } from "@playwright/test";

const PASSWORD = "correct-horse-battery";
const field = (page: Page, label: string, exact = false) =>
  page.getByLabel(label, { exact }).filter({ visible: true });

async function register(page: Page) {
  await page.goto("/register");
  await field(page, "Name").fill("SIP Tester");
  await field(page, "Email").fill(
    `sip-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`,
  );
  await field(page, "Password", true).fill(PASSWORD);
  await field(page, "Confirm password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

async function addBank(page: Page) {
  await page.goto("/accounts");
  await page.getByRole("button", { name: "Add account" }).first().click();
  const d = page.getByRole("dialog");
  await d.getByLabel("Name").fill("Sampath Savings");
  await d.getByLabel("Balance on opening date").fill("500000");
  await d.getByRole("button", { name: "Add account" }).click();
  await expect(page.getByText("Sampath Savings added")).toBeVisible();
}

async function addHolding(page: Page, name: string, first: boolean) {
  await page.goto("/assets");
  await page
    .getByRole("button", { name: first ? "Add your first holding" : "Add holding" })
    .first()
    .click();
  const wizard = page.getByRole("dialog");
  await wizard.getByRole("radio", { name: "Equity" }).click();
  await wizard.getByRole("button", { name: "Next" }).click();
  await wizard.getByRole("radio", { name: "Unit trust" }).click();
  await wizard.getByRole("button", { name: "Next" }).click();
  await wizard.getByLabel("Name").fill(name);
  await wizard.getByRole("button", { name: "Next" }).click();
  await wizard.getByLabel("Amount invested").fill("10000");
  await wizard.getByLabel("Current value").fill("10000");
  await wizard.getByRole("button", { name: "Add holding" }).click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
}

test("target → plan → execute partial → undo → skip", async ({ page }) => {
  await register(page);
  await addBank(page);
  await addHolding(page, "Fund A", true);
  await addHolding(page, "Fund B", false);

  // Target: Equity 100% → Fund A 60% / Fund B 40%
  await page.goto("/rebalancing");
  await expect(page.getByRole("heading", { level: 1, name: "Allocation" })).toBeVisible();
  await page.getByRole("combobox", { name: "Add an asset class" }).click();
  await page.getByRole("option", { name: "Equity" }).click();
  await page.getByRole("combobox", { name: "Add a holding to Equity" }).click();
  await page.getByRole("option", { name: "Fund A" }).click();
  await page.getByRole("combobox", { name: "Add a holding to Equity" }).click();
  await page.getByRole("option", { name: "Fund B" }).click();
  await field(page, "Fund A percent of class").fill("60");
  await field(page, "Fund B percent of class").fill("40");
  await expect(page.getByRole("status").filter({ hasText: "Total" })).toContainText("100.0%");
  await page.getByRole("button", { name: "Save target" }).click();
  await expect(page.getByText("Target allocation saved")).toBeVisible();

  // Plan: 10,000 a month from today, following the target
  await page.goto("/sip/plans/new");
  await field(page, "Name").fill("Monthly funds");
  await field(page, "Amount each period").fill("10000");
  await page.getByRole("button", { name: "Create plan" }).click();
  await expect(page).toHaveURL(/\/sip$/);
  await expect(page.getByText("Monthly funds")).toBeVisible();

  // Execute with one line lowered → partial
  await page
    .getByRole("link", { name: /^Execute Monthly funds/ })
    .first()
    .click();
  await expect(page).toHaveURL(/\/sip\/execute\//);
  await expect(page.getByText("Fund A")).toBeVisible();
  await field(page, "Actual").first().fill("4000");
  await expect(page.getByText("Will be marked partial")).toBeVisible();
  await page.getByRole("button", { name: "Confirm" }).click();
  await expect(page.getByText("SIP executed (partial)")).toBeVisible();
  await expect(page).toHaveURL(/tab=history/);
  const row = page.getByRole("list", { name: "SIP history" }).getByRole("listitem").first();
  await expect(row).toContainText("Partial");

  // The bank paid 4,000 + 4,000
  await page.goto("/accounts");
  await expect(page.getByText("LKR 492,000.00").first()).toBeVisible();

  // Undo → balance restored, period due again
  await page.goto("/sip?tab=history");
  await page
    .getByRole("button", { name: /^Undo Monthly funds/ })
    .first()
    .click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Undo" }).click();
  await expect(page.getByText("Undone")).toBeVisible();
  await page.goto("/accounts");
  await expect(page.getByText("LKR 500,000.00").first()).toBeVisible();

  // Skip it with a reason
  await page.goto("/sip?tab=upcoming");
  await page
    .getByRole("button", { name: /^Skip Monthly funds/ })
    .first()
    .click();
  await page.getByRole("dialog").getByLabel("Reason").fill("Short this month");
  await page.getByRole("button", { name: "Skip period" }).click();
  await expect(page.getByText("Period skipped")).toBeVisible();
  await page.goto("/sip?tab=history");
  await expect(page.getByRole("list", { name: "SIP history" })).toContainText("Skipped");
});
