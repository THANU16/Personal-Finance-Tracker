import type { LedgerTxn } from "@/domain/ledger";
import type { TransactionDoc } from "@/modules/transactions/model";

/** Projects a stored transaction onto the fields the pure ledger functions need. */
export function toLedgerTxn(
  doc: Pick<
    TransactionDoc,
    | "type"
    | "status"
    | "amountMinor"
    | "fromAccountId"
    | "toAccountId"
    | "toAmountMinor"
    | "feeMinor"
    | "taxMinor"
    | "reinvest"
    | "principalMinor"
    | "interestMinor"
    | "categoryId"
    | "splits"
  >,
): LedgerTxn {
  return {
    type: doc.type,
    status: doc.status,
    amountMinor: doc.amountMinor,
    fromAccountId: doc.fromAccountId ? String(doc.fromAccountId) : null,
    toAccountId: doc.toAccountId ? String(doc.toAccountId) : null,
    toAmountMinor: doc.toAmountMinor ?? null,
    feeMinor: doc.feeMinor ?? 0,
    taxMinor: doc.taxMinor ?? 0,
    reinvest: doc.reinvest ?? null,
    principalMinor: doc.principalMinor ?? null,
    interestMinor: doc.interestMinor ?? null,
    categoryId: doc.categoryId ? String(doc.categoryId) : null,
    splits: (doc.splits ?? []).map((s) => ({
      categoryId: String(s.categoryId),
      amountMinor: s.amountMinor,
    })),
  };
}

/** Fields to load for balance computations. */
export const LEDGER_PROJECTION = {
  type: 1,
  status: 1,
  date: 1,
  createdAt: 1,
  amountMinor: 1,
  fromAccountId: 1,
  toAccountId: 1,
  toAmountMinor: 1,
  feeMinor: 1,
  taxMinor: 1,
  reinvest: 1,
  principalMinor: 1,
  interestMinor: 1,
  categoryId: 1,
  splits: 1,
} as const;
