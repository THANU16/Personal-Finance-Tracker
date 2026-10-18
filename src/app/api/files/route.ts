// Implemented in Phase 11 (docs/06-BUILD-PLAN.md).
function notImplemented() {
  return Response.json({ error: "Not implemented yet" }, { status: 501 });
}

export const GET = notImplemented;
export const POST = notImplemented;
