"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { MoreHorizontal, Pause, Pencil, Play, Square, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { deletePlanAction, setPlanStatusAction } from "@/modules/sip/actions";

type Confirm = "end" | "delete" | null;

const CONFIRM = {
  end: {
    title: "End this plan?",
    description: "No new periods are created. Executed periods and their investments stay.",
    label: "End plan",
  },
  delete: {
    title: "Delete this plan?",
    description:
      "Only a plan that never invested can be deleted: the plan and its upcoming periods are removed. A plan with executed periods keeps its history; end it instead.",
    label: "Delete plan",
  },
} as const;

/**
 * Plan card actions (owner request, 2026-11-07): Edit opens the plan editor; ⋯ has Pause/Resume,
 * End plan and Delete (refused with the reason when the plan has executed periods).
 */
export function PlanCardActions({
  planId,
  name,
  status,
}: {
  planId: string;
  name: string;
  status: "active" | "paused" | "ended";
}) {
  const router = useRouter();
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [pending, setPending] = useState(false);

  async function setStatus(next: "active" | "paused" | "ended") {
    const result = await setPlanStatusAction(planId, next);
    if (!result.ok) {
      toast.error(result.error.message);
      return false;
    }
    toast.success(
      next === "paused" ? "Plan paused" : next === "ended" ? "Plan ended" : "Plan resumed",
    );
    router.refresh();
    return true;
  }

  async function run() {
    if (!confirm) return;
    setPending(true);
    const ok =
      confirm === "end"
        ? await setStatus("ended")
        : await deletePlanAction(planId).then((r) => {
            if (!r.ok) toast.error(r.error.message, { duration: 8000 });
            else toast.success(`${name} deleted`);
            return r.ok;
          });
    setPending(false);
    setConfirm(null);
    if (ok) router.refresh();
  }

  const c = confirm ? CONFIRM[confirm] : null;
  return (
    <>
      <Link
        href={`/sip/plans/${planId}`}
        className={buttonVariants({ size: "sm", variant: "outline" })}
      >
        <Pencil aria-hidden /> Edit
      </Link>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button variant="ghost" size="icon-sm" aria-label={`More actions for ${name}`} />}
        >
          <MoreHorizontal aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {status !== "ended" ? (
            <>
              <DropdownMenuItem
                onClick={() => void setStatus(status === "paused" ? "active" : "paused")}
              >
                {status === "paused" ? <Play aria-hidden /> : <Pause aria-hidden />}
                {status === "paused" ? "Resume" : "Pause"}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setConfirm("end")}>
                <Square aria-hidden /> End plan
              </DropdownMenuItem>
              <DropdownMenuSeparator />
            </>
          ) : null}
          <DropdownMenuItem variant="destructive" onClick={() => setConfirm("delete")}>
            <Trash2 aria-hidden /> Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <AlertDialog open={confirm !== null} onOpenChange={(o) => !pending && !o && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{c?.title}</AlertDialogTitle>
            <AlertDialogDescription>{c?.description}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" disabled={pending} onClick={() => void run()}>
              {pending ? "Working…" : c?.label}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
