import "server-only";
import { unstable_rethrow } from "next/navigation";
import { ok, toActionError, type ActionResult } from "@/server/action-result";

/** Runs a server-action body; maps failures to `ActionResult` but lets Next.js redirects through. */
export async function runAction<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return ok(await fn());
  } catch (err) {
    unstable_rethrow(err);
    return toActionError(err);
  }
}
