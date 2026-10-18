"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";

const RESEND_COOLDOWN_SECONDS = 60;
const CALLBACK_URL = "/verify-email?verified=1";

/**
 * After sign-up (?sent=1) or an unverified login (?email=…): explains the emailed link and offers a
 * resend with a cooldown. The link itself lands on ?verified=1 (or ?error=… when it is bad).
 */
export function VerifyEmailPanel() {
  const params = useSearchParams();
  const email = params.get("email");
  const [cooldown, setCooldown] = useState(params.get("sent") ? RESEND_COOLDOWN_SECONDS : 0);
  const [status, setStatus] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  if (params.get("verified") && !params.get("error")) {
    return (
      <div className="grid gap-4">
        <p role="status" className="text-sm">
          Your email is confirmed.
        </p>
        <Button render={<Link href="/dashboard" />}>Continue to WealthTrack</Button>
      </div>
    );
  }

  async function resend() {
    if (!email) return;
    setSending(true);
    await authClient.sendVerificationEmail({ email, callbackURL: CALLBACK_URL });
    setSending(false);
    setCooldown(RESEND_COOLDOWN_SECONDS);
    setStatus("If that account still needs confirming, a new link is on its way.");
  }

  return (
    <div className="grid gap-4">
      {params.get("error") ? (
        <p role="alert" className="text-sm text-destructive">
          That confirmation link is invalid or has expired. Log in to get a new one.
        </p>
      ) : (
        <p className="text-sm">
          {email ? (
            <>
              We sent a confirmation link to <span className="font-medium">{email}</span>. Open it
              to finish setting up your account. The link works for 24 hours.
            </>
          ) : (
            "Open the confirmation link we emailed you. Log in again to get a new link."
          )}
        </p>
      )}
      {status ? (
        <p role="status" className="text-sm text-muted-foreground">
          {status}
        </p>
      ) : null}
      {email ? (
        <Button variant="outline" onClick={resend} disabled={sending || cooldown > 0}>
          {cooldown > 0 ? `Resend link (${cooldown}s)` : sending ? "Sending…" : "Resend link"}
        </Button>
      ) : null}
      <p className="text-center text-sm text-muted-foreground">
        <Link href="/login" className="font-medium text-foreground underline underline-offset-4">
          Back to log in
        </Link>
      </p>
    </div>
  );
}
