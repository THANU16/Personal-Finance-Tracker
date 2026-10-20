import { restoreBackup } from "@/modules/backup/service";
import { toActionError } from "@/server/action-result";
import { getCurrentUser } from "@/server/auth/require-user";

// Restore a JSON backup (Phase 11) into the signed-in account — only when it is empty. A route
// handler, not a server action: backups are bigger than the 1 MB action body limit.
const MAX_BACKUP_BYTES = 50 * 1024 * 1024;

export async function POST(request: Request) {
  const current = await getCurrentUser();
  if (!current) {
    return Response.json(
      { ok: false, error: { code: "UNAUTHORIZED", message: "Sign in again" } },
      { status: 401 },
    );
  }
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BACKUP_BYTES) {
    return Response.json(
      { ok: false, error: { code: "VALIDATION", message: "The backup is larger than 50 MB" } },
      { status: 413 },
    );
  }
  try {
    const text = await request.text();
    if (text.length > MAX_BACKUP_BYTES) throw new Error("too large");
    const data = await restoreBackup(current.ctx, text);
    return Response.json({ ok: true, data });
  } catch (err) {
    const result = toActionError(err);
    const status =
      result.error.code === "INTERNAL" ? 500 : result.error.code === "CONFLICT" ? 409 : 400;
    return Response.json(result, { status });
  }
}
