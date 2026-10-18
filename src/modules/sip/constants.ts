// Client-safe SIP enums (the Mongoose model imports these; components must not import the model).
export const PLAN_STATUSES = ["active", "paused", "ended"] as const;
export type PlanStatus = (typeof PLAN_STATUSES)[number];
export const ALLOCATION_SOURCES = ["target", "custom"] as const;
export type AllocationSource = (typeof ALLOCATION_SOURCES)[number];
