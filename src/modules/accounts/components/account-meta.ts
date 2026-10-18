import {
  Banknote,
  BriefcaseBusiness,
  CreditCard,
  HandCoins,
  Landmark,
  PiggyBank,
  Wallet,
  Zap,
  type LucideIcon,
} from "lucide-react";
import type { AccountType } from "@/domain/accounts";

export const ACCOUNT_TYPE_META: Record<
  AccountType,
  { label: string; icon: LucideIcon; hint: string }
> = {
  bank: { label: "Bank account", icon: Landmark, hint: "Savings or current account" },
  cash: { label: "Cash", icon: Banknote, hint: "Physical cash" },
  wallet: { label: "Wallet", icon: Wallet, hint: "Mobile wallet or prepaid" },
  credit_card: {
    label: "Credit card",
    icon: CreditCard,
    hint: "Liability with a limit and due day",
  },
  loan: { label: "Loan", icon: PiggyBank, hint: "Money you owe a lender" },
  broker_cash: { label: "Broker cash", icon: BriefcaseBusiness, hint: "Cash held at a broker" },
  opportunity_fund: { label: "Opportunity fund", icon: Zap, hint: "Reserve for market dips" },
  receivable: { label: "Receivable", icon: HandCoins, hint: "Money someone owes you" },
  payable: { label: "Payable", icon: HandCoins, hint: "Money you owe someone (informal)" },
};
