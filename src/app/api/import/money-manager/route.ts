import { createMoneyManagerDraft } from "@/modules/imports/service";
import { MAX_FILE_BYTES } from "@/modules/imports/money-manager-file";
import { toActionError } from "@/server/action-result";
import { getCurrentUser } from "@/server/auth/require-user";

// docs/07 §2 — multipart upload of one or more Money Manager .xlsx exports → a draft import batch.
// Nothing is posted to the ledger here. Each file is limited to 10 MB.

const MAX_FILES = 5;
const XLSX_TYPES = new Set([
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/octet-stream",
  "",
]);

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
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return fail(400, "Upload the files as a form");
  }
  const files = form.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  if (!files.length) return fail(400, "Choose at least one .xlsx file");
  if (files.length > MAX_FILES) return fail(400, `Upload at most ${MAX_FILES} files at once`);
  for (const f of files) {
    if (!f.name.toLowerCase().endsWith(".xlsx") || !XLSX_TYPES.has(f.type)) {
      return fail(400, `${f.name} is not an Excel (.xlsx) file`);
    }
    if (f.size > MAX_FILE_BYTES) return fail(413, `${f.name} is larger than 10 MB`);
  }
  try {
    const buffers = await Promise.all(
      files.map(async (f) => ({ name: f.name, buffer: Buffer.from(await f.arrayBuffer()) })),
    );
    const data = await createMoneyManagerDraft(current.ctx, buffers);
    return Response.json({ ok: true, data }, { status: 201 });
  } catch (err) {
    const result = toActionError(err);
    return Response.json(result, { status: result.error.code === "INTERNAL" ? 500 : 400 });
  }
}
