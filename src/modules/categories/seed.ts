import type { CategoryKind } from "@/modules/categories/model";

/** docs/03 — system categories (isSystem; cannot be renamed or archived). */
export const SYSTEM_CATEGORIES: readonly { name: string; kind: CategoryKind }[] = [
  { name: "Loan interest", kind: "expense" },
  { name: "Bank fees", kind: "expense" },
  { name: "Investment fees", kind: "expense" },
  { name: "Investment income", kind: "income" },
  // Adjustments are excluded from cashflow by type; the kind only places it in the tree.
  { name: "Balance adjustment", kind: "expense" },
  { name: "Uncategorised", kind: "expense" },
  { name: "Uncategorised", kind: "income" },
];

export const SYSTEM_CATEGORY = {
  loanInterest: "Loan interest",
  bankFees: "Bank fees",
  investmentFees: "Investment fees",
  investmentIncome: "Investment income",
  balanceAdjustment: "Balance adjustment",
  uncategorised: "Uncategorised",
} as const;

/** Editable starter set seeded once on first login (owner-approved, Phase 2). */
export const STARTER_CATEGORIES: readonly {
  name: string;
  kind: CategoryKind;
  isEssential?: boolean;
  children?: readonly { name: string; isEssential?: boolean }[];
}[] = [
  {
    name: "Food & Dining",
    kind: "expense",
    children: [{ name: "Groceries", isEssential: true }, { name: "Restaurants" }],
  },
  {
    name: "Transport",
    kind: "expense",
    children: [{ name: "Fuel", isEssential: true }, { name: "Taxi & ride" }],
  },
  {
    name: "Housing",
    kind: "expense",
    children: [
      { name: "Rent", isEssential: true },
      { name: "Utilities", isEssential: true },
    ],
  },
  { name: "Health", kind: "expense", isEssential: true },
  { name: "Shopping", kind: "expense" },
  { name: "Entertainment", kind: "expense" },
  { name: "Education", kind: "expense", isEssential: true },
  { name: "Personal care", kind: "expense" },
  { name: "Gifts & donations", kind: "expense" },
  { name: "Salary", kind: "income" },
  { name: "Bonus", kind: "income" },
  { name: "Business", kind: "income" },
  { name: "Interest", kind: "income" },
  { name: "Other income", kind: "income" },
];
