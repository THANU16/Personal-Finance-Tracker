import { runDailyJob } from "@/server/cron/jobs/daily";
import { isCronAuthorized } from "@/server/cron/auth";
import { getEnv } from "@/server/env";

// Daily job (docs/06 Phase 10). Vercel Cron calls it with `Authorization: Bearer $CRON_SECRET`
// (vercel.json); any scheduler can do the same. Idempotent: running it twice changes nothing.
// Reading the request headers makes it dynamic (Next 16 + cacheComponents: no `dynamic` export).
export const maxDuration = 300;

export async function GET(request: Request) {
  if (!isCronAuthorized(request.headers.get("authorization"), getEnv().CRON_SECRET)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const results = await runDailyJob();
  const failed = results.flatMap((r) =>
    Object.entries(r.steps)
      .filter(([, s]) => !s.ok)
      .map(([name, s]) => ({ userId: r.userId, step: name, error: s.ok ? null : s.error })),
  );
  if (failed.length) console.error("[cron/daily] failed steps", failed);
  return Response.json({ users: results.length, failed: failed.length, results });
}
