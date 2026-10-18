export const ERROR_CODES = [
  "VALIDATION",
  "UNAUTHORIZED",
  "FORBIDDEN",
  "NOT_FOUND",
  "CONFLICT",
  /** The write is allowed only after the user confirms the listed warnings (dip guard, docs/04 §20). */
  "NEEDS_CONFIRMATION",
  "INTERNAL",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export type FieldErrors = Record<string, string[]>;

export const WARNING_CODES = [
  "DIPS_INTO_OPPORTUNITY",
  "DIPS_INTO_EMERGENCY",
  "WITHDRAWS_FROM_OPPORTUNITY",
  "WITHDRAWS_FROM_EMERGENCY",
] as const;
export type WarningCode = (typeof WARNING_CODES)[number];

/** What the user must confirm before retrying (amount in the account's currency). */
export interface ActionWarning {
  code: WarningCode;
  amountMinor: number;
  currency: string;
  accountName: string;
}

/** Expected, user-facing failure thrown by services. Actions map it to `{ ok: false, error }`. */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly fieldErrors?: FieldErrors;
  readonly warnings?: ActionWarning[];

  constructor(
    code: ErrorCode,
    message: string,
    fieldErrors?: FieldErrors,
    details?: { warnings?: ActionWarning[] },
  ) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.fieldErrors = fieldErrors;
    this.warnings = details?.warnings;
  }
}

export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError;
}
