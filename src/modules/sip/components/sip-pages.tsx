import { notFound, redirect } from "next/navigation";
import { utcToBusinessDate } from "@/domain/dates";
import { ExecuteForm } from "@/modules/sip/components/execute-form";
import { PlanEditor } from "@/modules/sip/components/plan-editor";
import { getExecuteView, getPlanEditor } from "@/modules/sip/queries";
import { getCurrentUser } from "@/server/auth/require-user";
import { AppError } from "@/server/errors";

async function ctxOrLogin() {
  const current = await getCurrentUser();
  if (!current) redirect("/login");
  return current.ctx;
}

async function orNotFound<T>(p: Promise<T>): Promise<T> {
  try {
    return await p;
  } catch (err) {
    if (err instanceof AppError && err.code === "NOT_FOUND") notFound();
    throw err;
  }
}

/** /sip/plans/new and /sip/plans/[id]. Render inside <Suspense>. */
export async function PlanEditorContent({ params }: { params?: Promise<{ id: string }> }) {
  const ctx = await ctxOrLogin();
  const id = params ? (await params).id : undefined;
  const data = await orNotFound(getPlanEditor(ctx, id));
  return <PlanEditor data={data} todayKey={utcToBusinessDate(new Date(), ctx.tz)} />;
}

/** /sip/execute/[executionId]. Render inside <Suspense>. */
export async function ExecuteContent({ params }: { params: Promise<{ executionId: string }> }) {
  const ctx = await ctxOrLogin();
  const { executionId } = await params;
  const view = await orNotFound(getExecuteView(ctx, executionId));
  if (view.execution.status !== "due" && view.execution.status !== "missed")
    redirect("/sip?tab=history");
  return <ExecuteForm view={view} todayKey={utcToBusinessDate(new Date(), ctx.tz)} />;
}
