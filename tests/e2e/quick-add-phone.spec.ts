import { expect, test } from "@playwright/test";

// docs/07 §5 (owner request, 2026-11-09): phone Quick add with the calculator keypad, category
// tiles (main → sub), account tiles with balances, the calendar panel and Continue.
test.use({ viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true });

const PASSWORD = "phone-quick-add-1";

test("phone quick add: keypad sum → category → save, then Continue", async ({ page }) => {
  test.setTimeout(180_000);
  const field = (label: string, exact = false) =>
    page.getByLabel(label, { exact }).filter({ visible: true });
  await page.goto("/register");
  await field("Name").fill("Phone Tester");
  await field("Email").fill(`phone-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`);
  await field("Password", true).fill(PASSWORD);
  await field("Confirm password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/onboarding$/);
  await page.goto("/accounts");
  await page.getByRole("button", { name: "Add account" }).first().click();
  const add = page.getByRole("dialog");
  await add.getByLabel("Name").fill("Bank");
  await add.getByLabel("Balance on opening date").fill("100000");
  await add.getByRole("button", { name: "Add account" }).click();
  await expect(page.getByText("Bank added")).toBeVisible();

  await page.goto("/dashboard");
  await page.getByRole("button", { name: "Quick add", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Quick add" });
  const pad = dialog.getByRole("group", { name: "Amount keypad" });
  await expect(pad).toBeVisible(); // a new form opens on the keypad

  for (const k of ["1", "2", "5", "0"])
    await pad.getByRole("button", { name: k, exact: true }).click();
  await pad.getByRole("button", { name: "Plus" }).click();
  for (const k of ["3", "4", "0"]) await pad.getByRole("button", { name: k, exact: true }).click();
  await expect(dialog.getByText("= LKR 1,590.00")).toBeVisible();
  await pad.getByRole("button", { name: "OK" }).click();

  // OK moves on to the category tiles; a main category with subs opens them.
  await expect(dialog.getByRole("heading", { name: "Category" })).toBeVisible();
  await dialog
    .getByRole("button", { name: /has sub-categories/ })
    .first()
    .click();
  await dialog
    .getByRole("group", { name: /sub-categories/ })
    .getByRole("button")
    .nth(1)
    .click();
  // Account is remembered, so the cursor goes to Note and the Save bar is back.
  await expect(dialog.locator("#qa-description")).toBeFocused();
  await expect(dialog.locator("#qa-from")).toContainText("Bank");

  // Account tiles show the balance (version B).
  await dialog.locator("#qa-from").click();
  await expect(dialog.getByRole("button", { name: /^Bank, 100,000\.00/ })).toBeVisible();
  await dialog.getByRole("button", { name: /^Bank, / }).click();

  // Date panel: Yesterday / Today (the account opens today, so the entry stays on today).
  await dialog.locator("#qa-date").click();
  await dialog.getByRole("button", { name: "Yesterday" }).click();
  await expect(dialog.locator("#qa-date")).toContainText("Yesterday");
  await dialog.locator("#qa-date").click();
  await dialog.getByRole("button", { name: "Today" }).click();
  await expect(dialog.locator("#qa-date")).toContainText("Today");

  await dialog.locator("#qa-description").fill("Weekly groceries");
  await dialog.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText("Expense saved")).toBeVisible();
  // Continue keeps the form open on an empty keypad with the same account.
  await expect(pad).toBeVisible();
  await expect(dialog.locator("#qa-amount")).toContainText("0.00");
  await expect(dialog.locator("#qa-from")).toContainText("Bank");

  await page.keyboard.press("Escape");
  await page.goto("/transactions");
  await expect(page.getByText("Weekly groceries").filter({ visible: true }).first()).toBeVisible();
});
