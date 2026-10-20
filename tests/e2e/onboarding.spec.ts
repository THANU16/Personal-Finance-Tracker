import { expect, test, type Page } from "@playwright/test";

// Phase 12 acceptance: register → onboarding → add account → expense → holding → SIP execute →
// dashboard.
const PASSWORD = "correct-horse-battery";
const field = (page: Page, label: string, exact = false) =>
  page.getByLabel(label, { exact }).filter({ visible: true });

test("register → onboarding → account → expense → holding → SIP execute → dashboard", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await page.goto("/register");
  await field(page, "Name").fill("Onboarding Tester");
  await field(page, "Email").fill(
    `onb-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`,
  );
  await field(page, "Password", true).fill(PASSWORD);
  await field(page, "Confirm password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/onboarding$/);

  // 1 Preferences
  await expect(page.getByText("Your preferences", { exact: true })).toBeVisible();
  await expect(field(page, "Base currency")).toHaveValue("LKR");
  await page.getByRole("button", { name: "Save and continue" }).click();

  // 2 Accounts
  await expect(page.getByText("Add your accounts", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Add account" }).click();
  const d = page.getByRole("dialog");
  await d.getByLabel("Name").fill("Sampath Savings");
  await d.getByLabel("Balance on opening date").fill("500000");
  await d.getByRole("button", { name: "Add account" }).click();
  await expect(page.getByText("Sampath Savings added")).toBeVisible();
  await expect(
    page.getByRole("listitem").filter({ hasText: "Sampath Savings" }).filter({ hasText: "LKR" }),
  ).toContainText("LKR 500,000.00");
  await page.getByRole("button", { name: "Continue" }).click();

  // 3 Holdings
  await expect(page.getByText("Add your investments", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Add holding" }).click();
  const wizard = page.getByRole("dialog");
  await wizard.getByRole("radio", { name: "Equity" }).click();
  await wizard.getByRole("button", { name: "Next" }).click();
  await wizard.getByRole("radio", { name: "Unit trust" }).click();
  await wizard.getByRole("button", { name: "Next" }).click();
  await wizard.getByLabel("Name").fill("Ceylon Equity Fund");
  await wizard.getByRole("button", { name: "Next" }).click();
  await wizard.getByLabel("Amount invested").fill("100000");
  await wizard.getByLabel("Current value").fill("100000");
  await wizard.getByRole("button", { name: "Add holding" }).click();
  // The wizard opens the new holding; come back to finish setup.
  await expect(page.getByRole("heading", { level: 1, name: "Ceylon Equity Fund" })).toBeVisible();
  await page.goto("/onboarding");
  await page.getByRole("button", { name: "Save and continue" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("listitem").filter({ hasText: "Ceylon Equity Fund" })).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();

  // 4 SIP (optional here; done below with a target) → 5 Done
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Go to the dashboard" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);

  // Expense with Quick add
  await page.locator("body").press("n");
  const sheet = page.getByRole("dialog", { name: "Quick add" });
  await expect(sheet).toBeVisible();
  await sheet.getByLabel("Amount").fill("2500");
  await field(page, "Category", true).click();
  await page.getByRole("option", { name: /Groceries/ }).click();
  await sheet.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Expense saved")).toBeVisible();

  // Target (Equity 100% → the fund) and a SIP following it, executed in full
  await page.goto("/rebalancing");
  await page.getByRole("combobox", { name: "Add an asset class" }).click();
  await page.getByRole("option", { name: "Equity" }).click();
  await page.getByRole("combobox", { name: "Add a holding to Equity" }).click();
  await page.getByRole("option", { name: "Ceylon Equity Fund" }).click();
  await field(page, "Ceylon Equity Fund percent of class").fill("100");
  await page.getByRole("button", { name: "Save target" }).click();
  await expect(page.getByText("Target allocation saved")).toBeVisible();

  await page.goto("/sip/plans/new");
  await field(page, "Name").fill("Monthly fund");
  await field(page, "Amount each period").fill("10000");
  await page.getByRole("button", { name: "Create plan" }).click();
  await expect(page).toHaveURL(/\/sip$/);
  await page
    .getByRole("link", { name: /^Execute Monthly fund/ })
    .first()
    .click();
  await expect(page).toHaveURL(/\/sip\/execute\//);
  await page.getByRole("button", { name: "Confirm" }).click();
  await expect(page.getByText("SIP executed")).toBeVisible();

  // Dashboard: 500,000 − 2,500 − 10,000 cash + 110,000 fund = 597,500
  await page.goto("/dashboard");
  await expect(page.getByLabel("Standing summary")).toBeVisible();
  await expect(page.getByText(/LKR 597\.50K|LKR 597,500\.00/).first()).toBeVisible();
});
