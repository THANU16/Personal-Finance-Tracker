import { z } from "zod";
import { AppError, type ErrorCode, type FieldErrors } from "@/server/errors";

export interface ActionError {
  code: ErrorCode;
  message: string;
  fieldErrors?: FieldErrors;
}

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: ActionError };

export function ok<T>(data: T): ActionResult<T> {
  return { ok: true, data };
}

/** Field errors keyed by dotted path (`notify.dailyHourLocal`), form-level issues under `_form`. */
export function zodFieldErrors(error: z.ZodError): FieldErrors {
  const out: FieldErrors = {};
  for (const issue of error.issues) {
    const key = issue.path.length ? issue.path.join(".") : "_form";
    (out[key] ??= []).push(issue.message);
  }
  return out;
}

/** Maps any thrown value to a safe action error. Unknown errors are logged, never exposed. */
export function toActionError(err: unknown): { ok: false; error: ActionError } {
  if (err instanceof AppError) {
    return {
      ok: false,
      error: {
        code: err.code,
        message: err.message,
        ...(err.fieldErrors ? { fieldErrors: err.fieldErrors } : {}),
      },
    };
  }
  if (err instanceof z.ZodError) {
    return {
      ok: false,
      error: {
        code: "VALIDATION",
        message: "Please fix the highlighted fields.",
        fieldErrors: zodFieldErrors(err),
      },
    };
  }
  console.error("Unexpected action error", err);
  return {
    ok: false,
    error: { code: "INTERNAL", message: "Something went wrong. Please try again." },
  };
}

/** Parses untrusted input or throws a VALIDATION AppError with field errors. */
export function parseInput<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new AppError(
      "VALIDATION",
      "Please fix the highlighted fields.",
      zodFieldErrors(result.error),
    );
  }
  return result.data;
}
