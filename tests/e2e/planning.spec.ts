import { expect, test, type Page } from "@playwright/test";

const PASSWORD = "correct-horse-battery";
const field = (page: Page, label: string, exact = false) =>
  page.getByLabel(label, { exact }).filter({ visible: true });

async function register(page: Page) {
  await page.goto("/register");
  await field(page, "Name").fill("Planning Tester");
  await field(page, "Email").fill(
    `plan-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`,
  );
  await field(page, "Password", true).fill(PASSWORD);
  await field(page, "Confirm password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/onboarding$/);
}

test("recurring confirm posts once and advances → budget counts the child category → goal progress", async ({
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

  // Recurring: a monthly grocery delivery due today.
  await page.goto("/recurring");
  await page.getByRole("button", { name: "New rule" }).first().click();
  const rule = page.getByRole("dialog", { name: "New recurring rule" });
  await rule.getByLabel("Name").fill("Grocery box");
  await rule.getByLabel("Amount").fill("2500");
  await field(page, "Category", true).click();
  await page.getByRole("option", { name: /Groceries/ }).click();
  await rule.getByRole("button", { name: "Add rule" }).click();
  await expect(page.getByText("Rule added")).toBeVisible();

  const row = page.getByTestId("rule-Grocery box");
  const dueBefore = await row.locator("td").nth(5).innerText();
  await row.getByRole("button", { name: "Confirm" }).click();
  const confirm = page.getByRole("dialog", { name: "Confirm Grocery box" });
  await confirm.getByLabel("Amount").fill("2600");
  await confirm.getByRole("button", { name: "Confirm" }).click();
  await expect(page.getByText("Grocery box posted")).toBeVisible();
  await expect(row.locator("td").nth(5)).not.toHaveText(dueBefore);

  await page.goto("/transactions");
  await expect(page.getByText("Grocery box").filter({ visible: true })).toHaveCount(1);

  // Budget on the parent category counts the child's spending.
  await page.goto("/budgets");
  await page.getByRole("button", { name: "Add budget" }).click();
  const b = page.getByRole("dialog", { name: "Add budget" });
  await field(page, "Category", true).click();
  await page.getByRole("option", { name: "Food & Dining", exact: true }).click();
  await b.getByLabel("Monthly budget").fill("3000");
  await b.getByRole("button", { name: "Save budget" }).click();
  await expect(page.getByText("Budget saved")).toBeVisible();
  const budget = page.getByTestId("budget-Food & Dining");
  await expect(budget).toContainText("LKR 2,600.00");
  await expect(budget).toContainText("80% used");

  // Goal linked to half of the bank account.
  await page.goto("/goals");
  await page.getByRole("button", { name: "New goal" }).first().click();
  const g = page.getByRole("dialog", { name: "New goal" });
  await g.getByLabel("Name").fill("Holiday");
  await g.getByLabel("Target amount").fill("200000");
  await field(page, "Target date", true).click();
  for (let i = 0; i < 12; i++) await page.getByRole("button", { name: /next month/i }).click();
  await page.getByRole("gridcell").filter({ hasText: /^1$/ }).first().click();
  await g.getByRole("combobox", { name: "Link an account or holding" }).click();
  await page.getByRole("option", { name: /^Bank/ }).click();
  await g.getByLabel("Share of Bank").fill("50");
  await g.getByRole("button", { name: "Add goal" }).click();
  await expect(page.getByText("Goal added")).toBeVisible();
  const card = page.getByTestId("goal-Holiday");
  await expect(card).toContainText("LKR 48,700.00"); // 50% of 97,400
  await expect(card.getByRole("img", { name: /reached/ })).toBeVisible();
});
