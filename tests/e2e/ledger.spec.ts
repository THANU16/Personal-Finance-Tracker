import { expect, test, type Page } from "@playwright/test";

const PASSWORD = "correct-horse-battery";

// Next 16 keeps previously visited pages mounted but hidden (<Activity>): match visible only.
const field = (page: Page, label: string, exact = false) =>
  page.getByLabel(label, { exact }).filter({ visible: true });

async function register(page: Page) {
  await page.goto("/register");
  await field(page, "Name").fill("Ledger Tester");
  await field(page, "Email").fill(
    `ledger-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`,
  );
  await field(page, "Password", true).fill(PASSWORD);
  await field(page, "Confirm password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

async function choose(page: Page, triggerLabel: string, option: string | RegExp) {
  await field(page, triggerLabel, true).click();
  await page.getByRole("option", { name: option }).click();
}

async function addAccount(page: Page, name: string, opening: string) {
  await page.goto("/accounts");
  await page.getByRole("button", { name: "Add account" }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Name").fill(name);
  await dialog.getByLabel("Balance on opening date").fill(opening);
  await dialog.getByRole("button", { name: "Add account" }).click();
  await expect(page.getByText(`${name} added`)).toBeVisible();
}

test("account → quick-add expense → balance updates → void restores it", async ({ page }) => {
  await register(page);
  await addAccount(page, "Sampath Savings", "100000");
  await addAccount(page, "Wallet cash", "5000"); // a second account, so a wrong default would show
  await expect(page.getByRole("link", { name: "Sampath Savings" })).toBeVisible();
  await expect(page.getByText("LKR 100,000.00").first()).toBeVisible();

  // Quick add via the N shortcut
  await page.locator("body").press("n");
  const sheet = page.getByRole("dialog", { name: "Quick add" });
  await expect(sheet).toBeVisible();
  // Regression: switching tabs keeps the account (income once went to a different account)
  await sheet.getByRole("tab", { name: "Income", exact: true }).click();
  await expect(field(page, "Received into", true)).toContainText("Sampath Savings");
  await sheet.getByRole("tab", { name: "Expense", exact: true }).click();
  await expect(field(page, "Paid from", true)).toContainText("Sampath Savings");
  await sheet.getByLabel("Amount").fill("1,250.50");
  await choose(page, "Category", /Groceries/);
  await sheet.getByLabel("Description").fill("Keells weekly shop");
  await sheet.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Expense saved")).toBeVisible();

  await page.goto("/accounts");
  await expect(page.getByText("LKR 98,749.50").first()).toBeVisible();

  // The account page shows the transaction with its running balance, then void it
  await page.getByRole("link", { name: "Sampath Savings" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Sampath Savings" })).toBeVisible();
  const row = page.getByRole("row", { name: /Keells weekly shop/ });
  await expect(row).toContainText("-LKR 1,250.50");
  await expect(row).toContainText("LKR 98,749.50");
  await row.getByRole("button", { name: "Transaction actions" }).click();
  await page.getByRole("menuitem", { name: "Void" }).click();
  const confirm = page.getByRole("alertdialog");
  await expect(confirm).toContainText("Restores LKR 1,250.50 to Sampath Savings");
  await confirm.getByRole("button", { name: "Void" }).click();
  await expect(page.getByText("Transaction voided")).toBeVisible();
  await expect(page.getByText("LKR 100,000.00").first()).toBeVisible();
});

test("transfer to a card and the transactions page summary", async ({ page }) => {
  await register(page);
  await addAccount(page, "Bank", "50000");

  await page.getByRole("button", { name: "Add account" }).first().click();
  const dialog = page.getByRole("dialog");
  await choose(page, "Type", "Credit card");
  await dialog.getByLabel("Name").fill("Visa");
  await dialog.getByLabel("Amount owed on opening date").fill("12000");
  await dialog.getByLabel("Credit limit").fill("100000");
  await dialog.getByLabel("Statement day").fill("20");
  await dialog.getByLabel("Due day").fill("5");
  await dialog.getByRole("button", { name: "Add account" }).click();
  await expect(page.getByText("Visa added")).toBeVisible();
  await expect(page.getByText("12.0% used")).toBeVisible();

  await page.goto("/transactions");
  await page.getByRole("button", { name: "Add transaction" }).first().click();
  const sheet = page.getByRole("dialog", { name: "Quick add" });
  await sheet.getByRole("tab", { name: "Transfer", exact: true }).click();
  await sheet.getByLabel("Amount").fill("12000");
  await choose(page, "From", /^Bank/);
  await choose(page, "To", /^Visa/);
  await sheet.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Transfer saved")).toBeVisible();

  // A card payment is a transfer: no expense in the summary
  await expect(page.getByText("1 transaction")).toBeVisible();
  await page.goto("/accounts");
  await expect(page.getByText("0.0% used")).toBeVisible();
  await expect(page.getByText("LKR 38,000.00").first()).toBeVisible();
});

test("settings show seeded categories and asset classes", async ({ page }) => {
  await register(page);
  await page.goto("/settings");
  await page.getByRole("tab", { name: "Categories" }).click();
  await expect(page.getByText("Food & Dining")).toBeVisible();
  await expect(page.getByText("Groceries")).toBeVisible();
  await page.getByRole("tab", { name: "Asset classes" }).click();
  await expect(page.getByText("Cash & Equivalents")).toBeVisible();
});
