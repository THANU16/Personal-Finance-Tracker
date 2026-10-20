import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";

const PASSWORD = "correct-horse-battery";
const field = (page: Page, label: string, exact = false) =>
  page.getByLabel(label, { exact }).filter({ visible: true });

async function register(page: Page) {
  await page.goto("/register");
  await field(page, "Name").fill("Valuation Importer");
  await field(page, "Email").fill(
    `val-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`,
  );
  await field(page, "Password", true).fill(PASSWORD);
  await field(page, "Confirm password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/onboarding$/);
}

test("upload a valuation CSV → preview with jumps → import into a new holding → undo", async ({
  page,
}) => {
  await register(page);
  await page.goto("/assets");
  await page.getByRole("link", { name: "Import history" }).click();
  await expect(page).toHaveURL(/\/assets\/import-valuations$/);

  await page.getByLabel("Valuation CSV files").setInputFiles({
    name: "CSE Stock - valuations 2026-10-18.csv",
    mimeType: "text/csv",
    buffer: (await import("node:fs")).readFileSync(
      join(process.cwd(), "tests/fixtures/valuations-cse-stock.csv"),
    ),
  });
  const card = page.getByTestId("import-card-CSE Stock");
  await expect(card).toContainText("45 rows");
  // No holdings yet → a new holding named from the file; the last value is the current value.
  await expect(card.getByLabel("New holding name")).toHaveValue("CSE Stock");
  await expect(card.getByTestId("summary-value")).toHaveText("LKR 336,083.00");
  await expect(card.getByText("Same day").first()).toBeVisible();

  // The 31 Mar jump is a deposit of 50,000 by default.
  const march = card.getByTestId("row-38");
  await expect(march).toContainText("2026-03-31");
  await expect(march.getByLabel("Amount for 2026-03-29>2026-03-31")).toHaveValue("50000.00");

  await card.getByRole("checkbox", { name: "I checked the jumps" }).click();
  await card.getByRole("button", { name: "Import 45 values" }).click();
  await expect(page.getByText("45 values imported")).toBeVisible();
  await expect(page.getByText("Import complete")).toBeVisible();

  await page.getByRole("button", { name: "Undo import" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Undo import" }).click();
  await expect(page.getByText("Import undone").first()).toBeVisible();

  await page.goto("/settings");
  await page.getByRole("tab", { name: "Data" }).click();
  await expect(page.getByText("Values · CSE Stock")).toBeVisible();
  await expect(page.getByText("Undone", { exact: true })).toBeVisible();
});
