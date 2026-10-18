import { z } from "zod";
import type { AllocationTree } from "@/domain/allocation";
import { validateRules } from "@/domain/opportunity";
import { dateKey } from "@/modules/accounts/schemas";
import { allocationTreeInputSchema } from "@/modules/allocation/schemas";

const objectId = z.string().regex(/^[a-f0-9]{24}$/i, "Choose an item");
const bp = z.number().int("Use whole basis points");
const minor = z
  .number()
  .int("Must be a whole amount")
  .min(0, "Cannot be negative")
  .max(Number.MAX_SAFE_INTEGER);

const RULE_MESSAGES = {
  out_of_range: "Use 0.01%–100%",
  drawdown_not_ascending: "Each drop must be deeper than the one before",
  deploy_decreasing: "Deploy % is cumulative: it cannot go down",
} as const;

export const fundSettingsSchema = z
  .object({
    benchmarkName: z.string().trim().min(1, "Name the benchmark").max(40),
    targetSizeMinor: minor.nullable(),
    rules: z
      .array(z.object({ drawdownBp: bp, deployPercentBp: bp }).strict())
      .min(1, "Add at least one rule")
      .max(10, "At most 10 rules"),
    allocationSource: z.enum(["target", "custom"]),
    allocation: allocationTreeInputSchema.nullish(),
    defaultSourceAccountId: objectId.nullable(),
  })
  .strict()
  .superRefine((v, ctx) => {
    for (const issue of validateRules(v.rules)) {
      ctx.addIssue({
        code: "custom",
        path: [
          "rules",
          issue.index,
          issue.code === "deploy_decreasing" ? "deployPercentBp" : "drawdownBp",
        ],
        message: RULE_MESSAGES[issue.code],
      });
    }
    if (v.allocationSource === "custom" && !v.allocation?.length) {
      ctx.addIssue({ code: "custom", path: ["allocation"], message: "Set the custom allocation" });
    }
  });
export type FundSettingsInput = z.input<typeof fundSettingsSchema>;

export const marketLevelSchema = z
  .object({
    date: dateKey,
    level: z
      .number({ error: "Enter the level" })
      .positive("Enter a level above zero")
      .max(1e9)
      .finite(),
    note: z.string().trim().max(200).nullish(),
  })
  .strict();

export const deploymentLineSchema = z
  .object({
    assetClassId: objectId,
    holdingId: objectId.nullable(),
    amountMinor: minor,
    feeMinor: minor.default(0),
  })
  .strict();

export const recordDeploymentSchema = z
  .object({
    date: dateKey,
    sourceAccountId: objectId,
    lines: z.array(deploymentLineSchema).min(1).max(60),
    notes: z.string().trim().max(500).nullish(),
  })
  .strict()
  .refine((v) => v.lines.some((l) => l.amountMinor > 0), {
    path: ["lines"],
    message: "Enter an amount on at least one line",
  });
export type RecordDeploymentInput = z.input<typeof recordDeploymentSchema>;

export const previewDeploymentSchema = z.object({
  amountMinor: minor.refine((v) => v > 0, "Enter an amount"),
});

// ----------------------------------------------------------------------------------- DTOs

export interface SourceAccountDTO {
  id: string;
  name: string;
  currency: string;
  /** Opportunity money on the account (dedicated account: its balance). */
  opportunityMinor: number;
  dedicated: boolean;
}

export interface DeploymentDTO {
  id: string;
  date: string;
  amountMinor: number;
  feeMinor: number;
  currency: string;
  sourceAccount: string;
  ruleIdx: number | null;
  drawdownBpAtDeploy: number;
  marketLevel: number | null;
  lines: { holding: string; assetClass: string; amountMinor: number; feeMinor: number }[];
  status: "posted" | "undone";
  notes: string | null;
}

export interface OpportunityOverviewDTO {
  baseCurrency: string;
  todayKey: string;
  settings: {
    benchmarkName: string;
    targetSizeMinor: number | null;
    rules: { drawdownBp: number; deployPercentBp: number }[];
    allocationSource: "target" | "custom";
    allocation: AllocationTree;
    defaultSourceAccountId: string | null;
  };
  /** Opportunity bucket in base currency (docs/04 §20). */
  fundBalanceMinor: number;
  fxMissing: number;
  cycle: {
    startedAt: string | null;
    fundBalanceAtStartMinor: number;
    referenceHigh: number | null;
    referenceHighDate: string | null;
    latest: { date: string; level: number } | null;
    drawdownBp: number;
    maxDrawdownBp: number;
    triggered: number[];
    deployedThisCycleMinor: number;
  };
  suggestion: { amountMinor: number; ruleIdx: number | null };
  levels: { id: string; date: string; level: number; note: string | null }[];
  sources: SourceAccountDTO[];
  deployments: DeploymentDTO[];
  /** The tree a deployment uses now (target or custom); empty → set one first. */
  allocationInUse: AllocationTree;
}

export interface DeploymentPreviewLine {
  assetClassId: string;
  holdingId: string | null;
  amountMinor: number;
}
