import writeXlsxFile from "write-excel-file/node";

// A small, anonymised Money Manager export that mirrors the structure of the real 2025 file
// (docs/07 §1, §6): trailing spaces, emoji categories, subcategories, transfers with fees (one fee
// resolved by its description, one standalone), Difference rows on accounts and on holdings,
// transfers into/out of holdings and between two holdings, receivable/payable accounts.

export interface FixtureRow {
  at: string; // "YYYY-MM-DD HH:mm:ss"
  account: string;
  category: string;
  sub?: string;
  note?: string;
  type: "Exp." | "Income" | "Transfer-Out" | "Transfer-In";
  description?: string;
  amount: string;
  currency?: string;
}

const HEADER = [
  "Period",
  "Accounts",
  "Category",
  "Subcategory",
  "Note",
  "LKR",
  "Income/Expense",
  "Description",
  "Amount",
  "Currency",
  "Accounts",
];

const t = (from: string, to: string, amount: string, at: string, note = ""): FixtureRow[] => [
  { at, account: from, category: to, note, type: "Transfer-Out", amount },
  { at, account: to, category: from, note, type: "Transfer-In", amount },
];

/** Rows of the 2025-style fixture (chronological; the file is written newest first like the app). */
export function fixtureRows2025(): FixtureRow[] {
  return [
    {
      at: "2025-01-01 08:00:00",
      account: "Sampath Bank",
      category: "💰 Salary",
      type: "Income",
      amount: "250000",
    },
    {
      at: "2025-01-02 12:30:00",
      account: "Cash In Hand ",
      category: "🍜 Food",
      sub: "Lunch",
      note: "Rice & curry",
      type: "Exp.",
      amount: "850",
    },
    {
      at: "2025-01-03 09:15:00",
      account: "Cash In Hand",
      category: "🍜 Food",
      sub: "Groceries",
      note: "Keells",
      description: "Weekly",
      type: "Exp.",
      amount: "6450.5",
    },
    ...t("Sampath Bank", "Cash In Hand", "20000", "2025-01-04 10:00:00", "ATM"),
    {
      at: "2025-01-04 10:00:00",
      account: "Sampath Bank",
      category: "Other",
      note: "Fees",
      description: "Sampath Bank → Cash In Hand",
      type: "Exp.",
      amount: "25",
    },
    ...t("Sampath Bank", "Give to Others", "5000", "2025-01-05 18:00:00"),
    ...t("Sampath Bank", "eZ Cash", "5000", "2025-01-05 18:00:00"),
    {
      at: "2025-01-05 18:00:00",
      account: "Sampath Bank",
      category: "Other",
      note: "Fees",
      description: "Sampath Bank → Give to frds",
      type: "Exp.",
      amount: "30",
    },
    {
      at: "2025-01-06 07:45:00",
      account: "eZ Cash",
      category: "🚌 Transport",
      sub: "Bus",
      type: "Exp.",
      amount: "120",
    },
    {
      at: "2025-01-08 08:30:00",
      account: "eZ Cash",
      category: "🏍️ Bike",
      sub: "Petrol",
      type: "Exp.",
      amount: "3000",
    },
    {
      at: "2025-01-09 08:30:00",
      account: "eZ Cash",
      category: "Petrol",
      type: "Exp.",
      amount: "2500",
    },
    ...t("Sampath Bank", "CAL Money Market", "100000", "2025-01-10 11:00:00"),
    {
      at: "2025-01-31 23:00:00",
      account: "CAL Money Market",
      category: "Interest",
      note: "Difference",
      type: "Income",
      amount: "850.75",
    },
    {
      at: "2025-02-01 08:00:00",
      account: "Sampath Bank",
      category: "💰 Salary",
      type: "Income",
      amount: "250000",
    },
    {
      at: "2025-02-02 10:00:00",
      account: "From Amma",
      category: "Family",
      type: "Income",
      amount: "15000",
    },
    ...t("From Amma", "Cash In Hand", "15000", "2025-02-02 10:05:00"),
    {
      at: "2025-02-03 19:30:00",
      account: "Cash In Hand",
      category: "Entertainment",
      note: "Difference",
      type: "Exp.",
      amount: "300",
    },
    {
      at: "2025-02-04 09:00:00",
      account: "Sampath Bank",
      category: "Salary",
      note: "Difference",
      type: "Income",
      amount: "75",
    },
    {
      at: "2025-02-05 14:00:00",
      account: "Sampath Bank",
      category: "Other",
      note: "Fees",
      description: "SMS alerts",
      type: "Exp.",
      amount: "50",
    },
    ...t("CAL Money Market", "Sampath Bank", "101500", "2025-02-20 10:00:00"),
    {
      at: "2025-02-21 09:00:00",
      account: "Binance",
      category: "Other",
      note: "Difference",
      type: "Income",
      amount: "40000",
    },
    ...t("Binance", "CAL Money Market", "10000", "2025-02-22 09:00:00"),
    {
      at: "2025-02-23 12:00:00",
      account: "Sampath Bank",
      category: "👨‍👩‍👧 Family",
      sub: "Gifts",
      type: "Exp.",
      amount: "4000",
    },
    {
      at: "2025-02-23 12:00:00",
      account: "Sampath Bank",
      category: "👨‍👩‍👧 Family",
      sub: "Gifts",
      type: "Exp.",
      amount: "4000",
    },
  ].flat() as FixtureRow[];
}

/** 2026 file overlapping the end of 2025 (one duplicate row) and adding new rows. */
export function fixtureRows2026(): FixtureRow[] {
  return [
    {
      at: "2025-02-23 12:00:00",
      account: "Sampath Bank",
      category: "👨‍👩‍👧 Family",
      sub: "Gifts",
      type: "Exp.",
      amount: "4000",
    },
    {
      at: "2026-01-01 08:00:00",
      account: "Sampath Bank",
      category: "💰 Salary",
      type: "Income",
      amount: "275000",
    },
    {
      at: "2026-01-02 12:30:00",
      account: "Cash In Hand",
      category: "🍜 Food",
      sub: "Lunch",
      type: "Exp.",
      amount: "900",
    },
  ];
}

function toDate(at: string): Date {
  return new Date(`${at.replace(" ", "T")}Z`);
}

/** Writes rows as a Money Manager .xlsx (newest first, like the app's export). */
export async function moneyManagerXlsx(rows: FixtureRow[], sheet = "2025"): Promise<Buffer> {
  const sorted = [...rows].reverse();
  const data = [
    HEADER.map((h) => ({ value: h, type: String })),
    ...sorted.map((r) => [
      { value: toDate(r.at), type: Date, format: "yyyy-mm-dd hh:mm:ss" },
      { value: r.account, type: String },
      { value: r.category, type: String },
      { value: r.sub ?? "", type: String },
      { value: r.note ?? "", type: String },
      { value: Number(r.amount), type: Number },
      { value: r.type, type: String },
      { value: r.description ?? "", type: String },
      { value: Number(r.amount), type: Number },
      { value: r.currency ?? "LKR", type: String },
      { value: Number(r.amount), type: Number },
    ]),
  ];
  return writeXlsxFile(data as never, { sheet }).toBuffer();
}
