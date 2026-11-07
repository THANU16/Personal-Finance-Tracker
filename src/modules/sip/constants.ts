// Client-safe SIP enums (the Mongoose model imports these; components must not import the model).
export const PLAN_STATUSES = ["active", "paused", "ended"] as const;
export type PlanStatus = (typeof PLAN_STATUSES)[number];
export const ALLOCATION_SOURCES = ["target", "custom"] as const;
export type AllocationSource = (typeof ALLOCATION_SOURCES)[number];
/**
 * Where a SIP's opportunity-fund share is kept (owner request, 2026-11-07): reserved in its "from"
 * account, transferred to another account, or bought into an asset (docs/04 §7).
 */
export const OPPORTUNITY_KEEP_IN = ["same", "account", "holding"] as const;
export type OpportunityKeepIn = (typeof OPPORTUNITY_KEEP_IN)[number];
