import { z } from "zod";
import type { AllocationTree } from "@/domain/allocation";
import { MISSED_POLICIES, SIP_FREQUENCIES, type ExecutionStatus } from "@/domain/sip";
import { dateKey } from "@/modules/accounts/schemas";
import { allocationTreeInputSchema } from "@/modules/allocation/schemas";
import { ALLOCATION_SOURCES, PLAN_STATUSES } from "@/modules/sip/constants";

const objectId = z.string().regex(/^[a-f0-9]{24}$/i, "Choose an item");
const positiveMinor = z
  .number()
  .int("Must be a whole amount")
  .min(1, "Enter an amount above zero")
  .max(Number.MAX_SAFE_INTEGER);
const minor = z
  .number()
  .int("Must be a whole amount")
  .min(0, "Cannot be negative")
  .max(Number.MAX_SAFE_INTEGER);

export const planInputSchema = z
  .object({
    name: z.string().trim().min(1, "Enter a name").max(80),
    amountMinor: positiveMinor,
    frequency: z.enum(SIP_FREQUENCIES),
    dayOfMonth: z
      .number()
      .int()
      .refine((d) => (d >= 1 && d <= 28) || d === 31, "Pick 1–28 or the last day")
      .nullish(),
    weekday: z.number().int().min(0).max(6).nullish(),
    sourceAccountId: objectId,
    startDate: dateKey,
    endDate: dateKey.nullish(),
    stepUp: z
      .object({
        percentBp: z.number().int().min(1, "Above 0%").max(10_000),
        everyMonths: z.number().int().min(1).max(120),
      })
      .strict()
      .nullish(),
    missedPolicy: z.enum(MISSED_POLICIES).default("skip"),
    graceDays: z.number().int().min(0).max(60).default(7),
    useDriftTilt: z.boolean().default(false),
    notes: z.string().trim().max(1000).nullish(),
    allocationSource: z.enum(ALLOCATION_SOURCES).default("target"),
    allocation: allocationTreeInputSchema.nullish(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.frequency === "monthly" && !v.dayOfMonth) {
      ctx.addIssue({ code: "custom", path: ["dayOfMonth"], message: "Pick a day of the month" });
    }
    if (v.frequency === "weekly" && (v.weekday === null || v.weekday === undefined)) {
      ctx.addIssue({ code: "custom", path: ["weekday"], message: "Pick a weekday" });
    }
    if (v.endDate && v.endDate < v.startDate) {
      ctx.addIssue({ code: "custom", path: ["endDate"], message: "End must be after the start" });
    }
    if (v.allocationSource === "custom" && !v.allocation?.length) {
      ctx.addIssue({ code: "custom", path: ["allocation"], message: "Build the allocation" });
    }
  });
export type PlanInput = z.input<typeof planInputSchema>;
export type PlanData = z.output<typeof planInputSchema>;

export const executeInputSchema = z
  .object({
    executedOn: dateKey,
    lines: z
      .array(
        z
          .object({
            holdingId: objectId.nullish(),
            actualMinor: minor,
            feeMinor: minor.default(0),
            units: z.number().positive("Above zero").finite().nullish(),
            priceMinorE4: z.number().int().positive().nullish(),
          })
          .strict(),
      )
      .min(1)
      .max(100),
    confirmOpportunity: z.boolean().optional(),
    confirmEmergency: z.boolean().optional(),
  })
  .strict();
export type ExecuteInput = z.input<typeof executeInputSchema>;

export const skipInputSchema = z
  .object({ reason: z.string().trim().min(1, "Give a reason").max(200) })
  .strict();

export const historyFiltersSchema = z.object({
  plan: objectId.optional().catch(undefined),
  status: z.enum(["due", "done", "partial", "skipped", "missed"]).optional().catch(undefined),
  from: dateKey.optional().catch(undefined),
  to: dateKey.optional().catch(undefined),
});
export type HistoryFilters = z.output<typeof historyFiltersSchema>;

export interface PlanDTO {
  id: string;
  name: string;
  status: (typeof PLAN_STATUSES)[number];
  amountMinor: number;
  currency: string;
  frequency: (typeof SIP_FREQUENCIES)[number];
  dayOfMonth: number | null;
  weekday: number | null;
  sourceAccountId: string;
  startDate: string;
  endDate: string | null;
  stepUp: { percentBp: number; everyMonths: number } | null;
  missedPolicy: (typeof MISSED_POLICIES)[number];
  graceDays: number;
  useDriftTilt: boolean;
  currentVersion: number;
  notes: string | null;
  allocationSource: (typeof ALLOCATION_SOURCES)[number];
  /** Custom tree of the current version (empty when following the target). */
  allocation: AllocationTree;
}

export interface ExecutionLineDTO {
  assetClassId: string;
  holdingId: string | null;
  plannedMinor: number;
  actualMinor: number;
  feeMinor: number;
  units: number | null;
  priceMinorE4: number | null;
  transactionId: string | null;
}

export interface ExecutionDTO {
  id: string;
  planId: string;
  planVersion: number;
  periodKey: string;
  dueDate: string;
  status: ExecutionStatus;
  plannedTotalMinor: number;
  carryInMinor: number;
  actualTotalMinor: number;
  executedOn: string | null;
  skipReason: string | null;
  onTime: boolean | null;
  useTilt: boolean;
  lines: ExecutionLineDTO[];
  allocationUsed: AllocationTree;
}
