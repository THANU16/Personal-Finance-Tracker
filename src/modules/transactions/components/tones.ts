// Transactions page colours (owner request, 2026-11-05): income blue, expense red, everything else
// muted. Transactions page only; contrast ≥ 4.5:1 in both themes. A plain module so server and
// client components can both import it.
export const TONE = {
  income: "text-blue-600 dark:text-blue-400",
  expense: "text-red-600 dark:text-red-400",
  neutral: "text-muted-foreground",
} as const;
