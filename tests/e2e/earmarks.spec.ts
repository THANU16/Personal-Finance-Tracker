import { expect, test, type Page } from "@playwright/test";

const PASSWORD = "correct-horse-battery";

const field = (page: Page, label: string, exact = false) =>
  page.getByLabel(label, { exact }).filter({ visible: true });

async function register(page: Page) {
  await page.goto("/register");
  await field(page, "Name").fill("Earmark Tester");
  await field(page, "Email").fill(
    `earmark-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`,
  );
  await field(page, "Password", true).fill(PASSWORD);
  await field(page, "Confirm password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
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

async function earmark(page: Page, bucket: "Emergency" | "Opportunity", amount: string) {
  await page.getByRole("button", { name: "Actions for Commercial Bank" }).click();
  await page.getByRole("menuitem", { name: "Earmark / move" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("radio", { name: bucket }).click();
  await dialog.getByLabel("Amount", { exact: true }).fill(amount);
  await dialog.getByRole("button", { name: "Save earmark" }).click();
  await expect(page.getByText("Earmark saved")).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
}

test("earmark an account → spend beyond free cash → confirm → buckets update", async ({ page }) => {
  await register(page);
  // docs/04 §20 worked example
  await addAccount(page, "Commercial Bank", "350000");
  await earmark(page, "Emergency", "100000");
  await earmark(page, "Opportunity", "200000");
  await expect(
    page.getByRole("img", {
      name: "Emergency LKR 100,000.00, Opportunity LKR 200,000.00, Free LKR 50,000.00",
    }),
  ).toBeVisible();

  // Spend 80,000: 30,000 more than free cash → confirmation
  await page.locator("body").press("n");
  const sheet = page.getByRole("dialog", { name: "Quick add" });
  await sheet.getByLabel("Amount").fill("80000");
  await field(page, "Category", true).click();
  await page.getByRole("option", { name: /Groceries/ }).click();
  await sheet.getByRole("button", { name: "Save" }).click();

  const confirm = page.getByRole("alertdialog");
  await expect(confirm.getByText("Use earmarked money?")).toBeVisible();
  await expect(confirm.getByRole("listitem")).toHaveText(
    "Uses LKR 30,000.00 of your opportunity money",
  );
  await confirm.getByRole("button", { name: "Confirm and save" }).click();
  await expect(page.getByText("Expense saved")).toBeVisible();

  await page.goto("/accounts");
  await expect(page.getByText("LKR 270,000.00").first()).toBeVisible();
  await expect(
    page.getByRole("img", {
      name: "Emergency LKR 100,000.00, Opportunity LKR 170,000.00, Free LKR 0.00",
    }),
  ).toBeVisible();
});

test("dipping into emergency money needs its own tick", async ({ page }) => {
  await register(page);
  await addAccount(page, "Commercial Bank", "100000");
  await earmark(page, "Emergency", "90000");

  await page.locator("body").press("n");
  const sheet = page.getByRole("dialog", { name: "Quick add" });
  await sheet.getByLabel("Amount").fill("30000");
  await field(page, "Category", true).click();
  await page.getByRole("option", { name: /Groceries/ }).click();
  await sheet.getByRole("button", { name: "Save" }).click();

  const confirm = page.getByRole("alertdialog");
  await expect(confirm.getByRole("listitem")).toHaveText(
    "Uses LKR 20,000.00 of your emergency money",
  );
  const save = confirm.getByRole("button", { name: "Confirm and save" });
  await expect(save).toBeDisabled();
  await confirm.getByRole("checkbox", { name: "Yes, use my emergency fund for this" }).click();
  await save.click();
  await expect(page.getByText("Expense saved")).toBeVisible();

  await page.goto("/accounts");
  await expect(
    page.getByRole("img", {
      name: "Emergency LKR 70,000.00, Opportunity LKR 0.00, Free LKR 0.00",
    }),
  ).toBeVisible();
});
