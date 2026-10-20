import { exportBackup } from "@/modules/backup/service";
import { reportCsv } from "@/modules/reports/csv";
import { exportTransactionsCsv } from "@/modules/transactions/queries";
import { transactionFiltersSchema } from "@/modules/transactions/schemas";
import { toActionError } from "@/server/action-result";
import { getCurrentUser } from "@/server/auth/require-user";

// Downloads (Phase 11): ?kind=backup (JSON) · ?kind=transactions&<list filters> (CSV) ·
// ?kind=report&report=<tab>&month|from|to|year (CSV). Always the signed-in user's data.

/** Byte-order mark so Excel opens UTF-8 CSV correctly. */
const UTF8_BOM = String.fromCharCode(0xfeff);

function file(body: string, fileName: string, type: string) {
  return new Response(body, {
    headers: {
      "Content-Type": `${type}; charset=utf-8`,
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function GET(request: Request) {
  const current = await getCurrentUser();
  if (!current) return new Response("Sign in again", { status: 401 });
  const url = new URL(request.url);
  const params = Object.fromEntries(url.searchParams.entries());
  try {
    switch (params.kind) {
      case "backup": {
        const b = await exportBackup(current.ctx);
        return file(b.json, b.fileName, "application/json");
      }
      case "transactions": {
        const filters = transactionFiltersSchema.parse(params);
        const t = await exportTransactionsCsv(current.ctx, filters);
        return file(`${UTF8_BOM}${t.csv}`, t.fileName, "text/csv");
      }
      case "report": {
        const r = await reportCsv(current.ctx, params.report ?? "", params);
        return file(`${UTF8_BOM}${r.csv}`, r.fileName, "text/csv");
      }
      default:
        return new Response("Unknown export", { status: 400 });
    }
  } catch (err) {
    const result = toActionError(err);
    return new Response(result.error.message, {
      status: result.error.code === "INTERNAL" ? 500 : 400,
    });
  }
}
