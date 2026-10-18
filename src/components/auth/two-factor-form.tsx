"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FormField, fieldAria } from "@/components/shared/form-field";
import { authClient } from "@/lib/auth-client";
import { backupCodeSchema, safeNextPath, totpCodeSchema } from "@/lib/auth-schemas";

type Mode = "totp" | "backup";

function errorMessage(code: string | undefined, mode: Mode): string {
  if (code === "INVALID_TWO_FACTOR_COOKIE") return "This sign-in has expired. Log in again.";
  if (code === "ACCOUNT_TEMPORARILY_LOCKED" || code === "TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE") {
    return "Too many failed attempts. Try again in 15 minutes.";
  }
  return mode === "totp"
    ? "That code is not valid. Try the latest one from your app."
    : "That backup code is not valid or was already used.";
}

/** Second login step: Better Auth keeps the pending sign-in in a short-lived cookie (10 min). */
export function TwoFactorForm() {
  const router = useRouter();
  const next = safeNextPath(useSearchParams().get("next"));
  const [mode, setMode] = useState<Mode>("totp");
  const [trustDevice, setTrustDevice] = useState(false);
  const {
    register,
    handleSubmit,
    setError,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<{ code: string }>({
    resolver: zodResolver(mode === "totp" ? totpCodeSchema : backupCodeSchema),
  });

  async function onSubmit({ code }: { code: string }) {
    const { error } =
      mode === "totp"
        ? await authClient.twoFactor.verifyTotp({ code, trustDevice })
        : await authClient.twoFactor.verifyBackupCode({ code, trustDevice });
    if (error) {
      setError("code", { message: errorMessage(error.code, mode) });
      return;
    }
    router.replace(next);
    router.refresh();
  }

  function switchMode() {
    setMode((m) => (m === "totp" ? "backup" : "totp"));
    reset({ code: "" });
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="grid gap-4">
      <FormField
        id="code"
        label={mode === "totp" ? "Authentication code" : "Backup code"}
        error={errors.code?.message}
      >
        <Input
          id="code"
          key={mode}
          autoFocus
          autoComplete="one-time-code"
          inputMode={mode === "totp" ? "numeric" : "text"}
          {...fieldAria("code", errors.code?.message)}
          {...register("code")}
        />
      </FormField>
      <Label className="flex items-center gap-2 font-normal">
        <Checkbox checked={trustDevice} onCheckedChange={(v) => setTrustDevice(v === true)} />
        Trust this device for 30 days
      </Label>
      <Button type="submit" disabled={isSubmitting} className="w-full">
        {isSubmitting ? "Checking…" : "Verify"}
      </Button>
      <Button type="button" variant="link" onClick={switchMode}>
        {mode === "totp" ? "Use a backup code instead" : "Use your authenticator app instead"}
      </Button>
      <p className="text-center text-sm text-muted-foreground">
        <Link href="/login" className="font-medium text-foreground underline underline-offset-4">
          Back to log in
        </Link>
      </p>
    </form>
  );
}
