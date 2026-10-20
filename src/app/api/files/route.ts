import { MAX_ATTACHMENT_BYTES } from "@/modules/attachments/model";
import { uploadAttachment } from "@/modules/attachments/service";
import { toActionError } from "@/server/action-result";
import { getCurrentUser } from "@/server/auth/require-user";

// docs/02 — attachment upload (multipart: `file`, `transactionId`). Type and size are validated
// again in the service (declared type + file signature). Download: /api/files/[id].

function fail(status: number, message: string) {
  return Response.json({ ok: false, error: { code: "VALIDATION", message } }, { status });
}

export async function POST(request: Request) {
  const current = await getCurrentUser();
  if (!current) {
    return Response.json(
      { ok: false, error: { code: "UNAUTHORIZED", message: "Sign in again" } },
      { status: 401 },
    );
  }
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > MAX_ATTACHMENT_BYTES + 64 * 1024) return fail(413, "Files can be at most 10 MB");
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return fail(400, "Upload the file as a form");
  }
  const file = form.get("file");
  const transactionId = form.get("transactionId");
  if (!(file instanceof File) || file.size === 0) return fail(400, "Choose a file");
  if (typeof transactionId !== "string") return fail(400, "Missing transaction");
  if (file.size > MAX_ATTACHMENT_BYTES) return fail(413, "Files can be at most 10 MB");
  try {
    const data = await uploadAttachment(current.ctx, {
      transactionId,
      fileName: file.name,
      mimeType: file.type,
      bytes: new Uint8Array(await file.arrayBuffer()),
    });
    return Response.json({ ok: true, data }, { status: 201 });
  } catch (err) {
    const result = toActionError(err);
    const status =
      result.error.code === "INTERNAL" ? 500 : result.error.code === "NOT_FOUND" ? 404 : 400;
    return Response.json(result, { status });
  }
}
