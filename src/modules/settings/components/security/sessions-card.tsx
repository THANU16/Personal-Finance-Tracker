"use client";

import { Laptop } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { describeUserAgent } from "@/lib/user-agent";
import { revokeOtherSessionsAction, revokeSessionAction } from "@/modules/settings/actions";
import type { SessionDTO } from "@/modules/settings/security";

function when(iso: string, locale: string, timeZone: string): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
  }).format(new Date(iso));
}

export function SessionsCard({
  sessions,
  locale,
  timeZone,
}: {
  sessions: SessionDTO[];
  locale: string;
  timeZone: string;
}) {
  const router = useRouter();
  const others = sessions.filter((s) => !s.current).length;

  async function revoke(id: string) {
    const result = await revokeSessionAction(id);
    if (!result.ok) {
      toast.error(result.error.message);
      return false;
    }
    toast.success("Device signed out");
    router.refresh();
  }

  async function revokeOthers() {
    const result = await revokeOtherSessionsAction();
    if (!result.ok) {
      toast.error(result.error.message);
      return false;
    }
    toast.success("Other devices signed out");
    router.refresh();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Active sessions</CardTitle>
        <CardDescription>Devices signed in to your account.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <ul className="grid gap-2" aria-label="Active sessions">
          {sessions.map((s) => (
            <li
              key={s.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3"
            >
              <div className="flex items-start gap-3">
                <Laptop className="mt-0.5 size-4 text-muted-foreground" aria-hidden />
                <div className="grid gap-0.5 text-sm">
                  <span className="flex items-center gap-2 font-medium">
                    {describeUserAgent(s.userAgent)}
                    {s.current ? <Badge variant="secondary">This device</Badge> : null}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {s.ipAddress ? `${s.ipAddress} · ` : ""}Signed in{" "}
                    {when(s.createdAt, locale, timeZone)} · Last active{" "}
                    {when(s.updatedAt, locale, timeZone)}
                  </span>
                </div>
              </div>
              {s.current ? null : (
                <ConfirmDialog
                  trigger={
                    <Button variant="outline" size="sm">
                      Sign out
                    </Button>
                  }
                  title="Sign out this device?"
                  description={`${describeUserAgent(s.userAgent)} will need to log in again.`}
                  confirmLabel="Sign out"
                  destructive
                  onConfirm={() => revoke(s.id)}
                />
              )}
            </li>
          ))}
        </ul>
        {others > 0 ? (
          <div>
            <ConfirmDialog
              trigger={<Button variant="outline">Sign out other devices</Button>}
              title="Sign out other devices?"
              description={`${others} other ${others === 1 ? "device" : "devices"} will need to log in again. This device stays signed in.`}
              confirmLabel="Sign out others"
              destructive
              onConfirm={revokeOthers}
            />
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
