import { readAttachment } from "@/modules/attachments/service";
import { getCurrentUser } from "@/server/auth/require-user";

// Authenticated attachment download: only the owner's file; anything else is a plain 404.
// Served sandboxed with nosniff so a file can never run as a page of this site.

export async function GET(request: Request, { params }: RouteContext<"/api/files/[id]">) {
  const current = await getCurrentUser();
  if (!current) return new Response("Sign in again", { status: 401 });
  const { id } = await params;
  const file = await readAttachment(current.ctx, id);
  if (!file) return new Response("Not found", { status: 404 });
  // PDFs always download (the browser's PDF viewer doesn't run under a sandbox CSP); images open inline.
  const download =
    new URL(request.url).searchParams.get("download") === "1" ||
    file.mimeType === "application/pdf";
  const encoded = encodeURIComponent(file.fileName);
  return new Response(Buffer.from(file.bytes), {
    headers: {
      "Content-Type": file.mimeType,
      "Content-Length": String(file.bytes.byteLength),
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${file.fileName.replace(/"/g, "")}"; filename*=UTF-8''${encoded}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy":
        "sandbox; default-src 'none'; img-src 'self'; style-src 'unsafe-inline'",
    },
  });
}
