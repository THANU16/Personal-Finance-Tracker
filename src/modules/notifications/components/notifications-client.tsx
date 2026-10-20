"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { format, parseISO } from "date-fns";
import { AlertOctagon, AlertTriangle, BellOff, Check, Clock, Info } from "lucide-react";
import { toast } from "sonner";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Severity } from "@/domain/notifications";
import { addDays } from "@/domain/recurring";
import { cn } from "@/lib/utils";
import { markAllReadAction, markReadAction, snoozeAction } from "@/modules/notifications/actions";
import type { NotificationDTO } from "@/modules/notifications/service";

type Item = NotificationDTO & { day: string };

const ICON: Record<Severity, { Icon: typeof Info; label: string; className: string }> = {
  info: { Icon: Info, label: "Info", className: "text-muted-foreground" },
  warning: { Icon: AlertTriangle, label: "Warning", className: "text-amber-600" },
  critical: { Icon: AlertOctagon, label: "Critical", className: "text-destructive" },
};

function Row({ n }: { n: Item }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const { Icon, label, className } = ICON[n.severity];
  const run = (fn: () => Promise<{ ok: boolean; error?: { message: string } }>, done?: string) =>
    start(async () => {
      const res = await fn();
      if (!res.ok) toast.error(res.error?.message ?? "Something went wrong");
      else {
        if (done) toast.success(done);
        router.refresh();
      }
    });
  return (
    <li className={cn("flex items-start gap-3 px-4 py-3", !n.read && "bg-muted/40")}>
      <Icon className={cn("mt-0.5 size-4 shrink-0", className)} aria-label={label} />
      <div className="min-w-0 flex-1">
        <Link
          href={n.link}
          onClick={() => {
            if (!n.read) void markReadAction(n.id);
          }}
          className={cn("underline-offset-4 hover:underline", !n.read && "font-semibold")}
        >
          {n.title}
        </Link>
        {!n.read ? <span className="sr-only"> (unread)</span> : null}
        {n.body ? <p className="text-sm text-muted-foreground">{n.body}</p> : null}
        <p className="text-xs text-muted-foreground">
          {format(parseISO(n.createdAt), "d MMM, HH:mm")}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {!n.read ? (
          <Button
            size="icon"
            variant="ghost"
            aria-label={`Mark "${n.title}" read`}
            title="Mark read"
            disabled={pending}
            onClick={() => run(() => markReadAction(n.id))}
          >
            <Check aria-hidden />
          </Button>
        ) : null}
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                size="icon"
                variant="ghost"
                aria-label={`Snooze "${n.title}"`}
                title="Snooze"
                disabled={pending}
              />
            }
          >
            <Clock aria-hidden />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {[1, 3, 7].map((d) => (
              <DropdownMenuItem
                key={d}
                onClick={() =>
                  run(() => snoozeAction(n.id, d), `Snoozed for ${d} day${d === 1 ? "" : "s"}`)
                }
              >
                {d === 1 ? "1 day" : `${d} days`}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </li>
  );
}

export function NotificationsClient({ today, items }: { today: string; items: Item[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  if (items.length === 0) {
    return (
      <EmptyState
        icon={<BellOff className="size-6" aria-hidden />}
        title="No notifications"
        description="The daily check raises reminders for SIPs, bills, EMIs, card dues, FD maturities, renewals, budgets and goals."
      />
    );
  }
  const weekStart = addDays(today, -6);
  const groups: [string, Item[]][] = [
    ["Today", items.filter((n) => n.day === today)],
    ["This week", items.filter((n) => n.day < today && n.day >= weekStart)],
    ["Earlier", items.filter((n) => n.day < weekStart)],
  ];
  const unread = items.filter((n) => !n.read).length;
  return (
    <div className="grid gap-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">{unread ? `${unread} unread` : "All read"}</p>
        <Button
          size="sm"
          variant="outline"
          disabled={!unread || pending}
          onClick={() =>
            start(async () => {
              const res = await markAllReadAction();
              if (!res.ok) toast.error(res.error.message);
              else router.refresh();
            })
          }
        >
          Mark all read
        </Button>
      </div>
      {groups
        .filter(([, list]) => list.length)
        .map(([title, list]) => (
          <section key={title} aria-labelledby={`n-${title}`}>
            <h2 id={`n-${title}`} className="mb-2 text-sm font-medium text-muted-foreground">
              {title}
            </h2>
            <Card className="py-0">
              <CardContent className="px-0">
                <ul className="divide-y">
                  {list.map((n) => (
                    <Row key={n.id} n={n} />
                  ))}
                </ul>
              </CardContent>
            </Card>
          </section>
        ))}
    </div>
  );
}
