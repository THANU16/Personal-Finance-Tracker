import { format, parseISO } from "date-fns";
import { redirect } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatPercentBp } from "@/lib/format";
import { TargetEditor } from "@/modules/allocation/components/target-editor";
import { getTarget, getTreeOptions, listTargetHistory } from "@/modules/allocation/service";
import { getCurrentUser } from "@/server/auth/require-user";

/** Server part of /rebalancing → Plan. Render inside <Suspense>. */
export async function TargetPlanContent() {
  const current = await getCurrentUser();
  if (!current) redirect("/login");
  const [target, options, history] = await Promise.all([
    getTarget(current.ctx),
    getTreeOptions(current.ctx),
    listTargetHistory(current.ctx, 10),
  ]);
  const className = new Map(options.classes.map((c) => [c.id, c.name]));
  return (
    <div className="grid gap-4">
      <TargetEditor target={target} options={options} />
      {history.length ? (
        <Card>
          <CardHeader>
            <CardTitle>History</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y text-sm" aria-label="Target allocation history">
              {history.map((h) => (
                <li key={h.id} className="grid gap-0.5 py-2">
                  <span className="font-medium">
                    {format(parseISO(h.savedAt), "d MMM yyyy, HH:mm")}
                  </span>
                  <span className="text-muted-foreground">
                    {h.allocation
                      .map(
                        (c) =>
                          `${className.get(c.assetClassId) ?? "Class"} ${formatPercentBp(c.percentBp)}`,
                      )
                      .join(" · ")}
                    {h.note ? ` — ${h.note}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
