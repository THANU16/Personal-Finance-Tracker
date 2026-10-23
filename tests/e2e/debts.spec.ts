import { expect, test, type Page } from "@playwright/test";

const PASSWORD = "correct-horse-battery";
const field = (page: Page, label: string, exact = false) =>
  page.getByLabel(label, { exact }).filter({ visible: true });

async function register(page: Page) {
  await page.goto("/register");
  await field(page, "Name").fill("Debt Tester");
  await field(page, "Email").fill(
    `debt-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`,
  );
  await field(page, "Password", true).fill(PASSWORD);
  await field(page, "Confirm password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/onboarding$/);
}

const statCard = (page: Page, label: string) =>
  page.locator("[data-slot=card]").filter({ hasText: label });

async function choose(page: Page, label: string, option: string | RegExp) {
  await field(page, label, true).click();
  await page.getByRole("option", { name: option }).click();
}

test("add loan → EMI preview → pay → schedule ticks → prepay (finish sooner)", async ({ page }) => {
  await register(page);
  await page.goto("/accounts");
  await page.getByRole("button", { name: "Add account" }).first().click();
  const d = page.getByRole("dialog");
  await d.getByLabel("Name").fill("Sampath");
  await d.getByLabel("Balance on opening date").fill("100000");
  await d.getByRole("button", { name: "Add account" }).click();
  await expect(page.getByText("Sampath added")).toBeVisible();

  await page.goto("/debts");
  await expect(page.getByText("No loans")).toBeVisible();
  await page.getByRole("button", { name: "Add loan" }).click();
  const dialog = page.getByRole("dialog", { name: "Add loan" });
  await dialog.getByLabel("Name").fill("Car loan");
  await dialog.getByLabel("Loan amount").fill("1000000");
  await dialog.getByLabel("Annual interest rate").fill("12");
  await dialog.getByLabel("Tenure (months)").fill("12");
  await expect(dialog.getByText("Monthly instalment (EMI)").locator("..")).toContainText(
    "LKR 88,848.79",
  );
  await choose(page, "EMIs paid from", /^Sampath/);
  await choose(page, "Money received into (optional)", /^Sampath/);
  await dialog.getByRole("button", { name: "Add loan" }).click();

  await expect(page.getByRole("heading", { level: 1, name: "Car loan" })).toBeVisible();
  await expect(page.getByText("LKR 1,000,000.00").first()).toBeVisible();
  await expect(page.locator('tr[data-state="projected"]')).toHaveCount(12);

  await page.getByRole("button", { name: "Record payment" }).click();
  const pay = page.getByRole("dialog", { name: "Record payment" });
  await expect(pay.getByText("Interest (expense)").locator("..")).toContainText("LKR 10,000.00");
  await expect(pay.getByText("Principal (reduces the loan)").locator("..")).toContainText(
    "LKR 78,848.79",
  );
  await pay.getByRole("button", { name: "Record payment" }).click();
  await expect(page.getByText("Payment recorded")).toBeVisible();
  await expect(page.locator('tr[data-state="paid"]')).toHaveCount(1);
  await expect(page.getByText("LKR 921,151.21").first()).toBeVisible();
  // Owner request: total paid so far and what the loan costs in interest over its whole life.
  await expect(statCard(page, "Total paid so far")).toContainText("LKR 88,848.79");
  await expect(statCard(page, "Total interest of this loan")).toContainText("LKR 66,185.45");
  if (process.env.E2E_SHOTS)
    await page.screenshot({ path: `${process.env.E2E_SHOTS}/loan.png`, fullPage: true });

  await page.getByRole("button", { name: "Prepayment" }).click();
  const pre = page.getByRole("dialog", { name: "Prepayment" });
  await pre.getByLabel("Amount").fill("300000");
  await pre.getByRole("button", { name: "Compare before / after" }).click();
  const table = pre.getByRole("table", { name: "Before and after the prepayment" });
  await expect(table.getByRole("row", { name: /Months left/ })).toContainText("11");
  await expect(table.getByRole("row", { name: /Months left/ })).toContainText("8");
  await pre.getByRole("button", { name: "Record prepayment" }).click();
  await expect(page.getByText("Prepayment recorded")).toBeVisible();
  await expect(page.locator('tr[data-state="projected"]')).toHaveCount(8);

  // Edit everything any time: a lower rate rebuilds the EMI over the months left.
  await page.getByRole("button", { name: "Edit loan" }).click();
  const editDialog = page.getByRole("dialog", { name: "Edit loan" });
  await editDialog.getByLabel("Name").fill("Car loan (NSB)");
  await editDialog.getByLabel("Annual interest rate").fill("10");
  await editDialog.getByRole("button", { name: "Save loan" }).click();
  await expect(page.getByText("Loan saved")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "Car loan (NSB)" })).toBeVisible();
  await expect(page.getByText("10.0% a year")).toBeVisible();

  // The list shows the loan; interest (not principal) appears as an expense in transactions.
  await page.goto("/debts");
  await expect(page.getByRole("link", { name: "Car loan (NSB)" })).toBeVisible();
  await page.goto("/transactions");
  await expect(page.getByText("Loan payment").first()).toBeVisible();

  // The loan account page shows the same cards; a payment row shows what was paid.
  await page.goto("/accounts");
  await page.getByRole("link", { name: "Car loan (NSB)" }).first().click();
  await expect(page.getByText("Total interest of this loan")).toBeVisible();
  await expect(statCard(page, "Total paid so far")).toContainText("LKR 388,848.79");
  await expect(page.getByText(/Loan reduced by/).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Open loan" })).toBeVisible();
  if (process.env.E2E_SHOTS)
    await page.screenshot({ path: `${process.env.E2E_SHOTS}/loan-account.png`, fullPage: true });
});
