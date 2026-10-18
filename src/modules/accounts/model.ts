import { Schema, type Types } from "mongoose";
import { ACCOUNT_TYPES, type AccountType } from "@/domain/accounts";
import { intField, userScopedModel } from "@/server/db/model";

// docs/03-DATA-MODEL.md — accounts
export interface AccountDoc {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  name: string;
  type: AccountType;
  currency: string;
  institution: string | null;
  notes: string | null;
  color: string | null;
  icon: string | null;
  /** Signed; liabilities negative. */
  openingBalanceMinor: number;
  openingDate: Date;
  includeInNetWorth: boolean;
  countsTowardEmergencyFund: boolean;
  creditCard: { limitMinor: number; statementDay: number; dueDay: number } | null;
  counterparty: string | null;
  /** cache — recomputeAccount */
  balanceMinor: number;
  /** cache — recomputeAccount */
  lastTransactionAt: Date | null;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const accountSchema = new Schema<AccountDoc>(
  {
    userId: { type: Schema.Types.ObjectId, required: true },
    name: { type: String, required: true, trim: true },
    type: { type: String, enum: ACCOUNT_TYPES, required: true },
    currency: { type: String, required: true },
    institution: { type: String, default: null },
    notes: { type: String, default: null },
    color: { type: String, default: null },
    icon: { type: String, default: null },
    openingBalanceMinor: intField({ required: true, default: 0 }),
    openingDate: { type: Date, required: true },
    includeInNetWorth: { type: Boolean, required: true, default: true },
    countsTowardEmergencyFund: { type: Boolean, required: true, default: false },
    creditCard: {
      type: new Schema(
        {
          limitMinor: intField({ required: true, min: 0 }),
          statementDay: intField({ required: true, min: 1, max: 31 }),
          dueDay: intField({ required: true, min: 1, max: 31 }),
        },
        { _id: false },
      ),
      default: null,
    },
    counterparty: { type: String, default: null },
    balanceMinor: intField({ required: true, default: 0 }),
    lastTransactionAt: { type: Date, default: null },
    archivedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

accountSchema.index({ userId: 1, type: 1 });
accountSchema.index({ userId: 1, archivedAt: 1 });

export const AccountModel = userScopedModel<AccountDoc>("Account", accountSchema, "accounts");
