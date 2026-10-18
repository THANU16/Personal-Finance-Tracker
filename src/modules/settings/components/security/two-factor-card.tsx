"use client";

import { useRouter } from "next/navigation";
import QRCode from "qrcode";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { FormField, fieldAria } from "@/components/shared/form-field";
import { authClient } from "@/lib/auth-client";
import {
  passwordConfirmSchema,
  totpCodeSchema,
  type PasswordConfirmInput,
} from "@/lib/auth-schemas";

type Flow = "enable" | "regenerate" | "disable";

type Step =
  | { kind: "password" }
  | { kind: "scan"; qrSvg: string; manualKey: string; backupCodes: string[] }
  | { kind: "codes"; backupCodes: string[] };

const FLOW_TEXT: Record<Flow, { title: string; description: string; submit: string }> = {
  enable: {
    title: "Turn on two-factor authentication",
    description: "Confirm your password to start.",
    submit: "Continue",
  },
  regenerate: {
    title: "New backup codes",
    description: "Your old backup codes stop working. Confirm your password.",
    submit: "Create new codes",
  },
  disable: {
    title: "Turn off two-factor authentication",
    description: "Logging in will need only your password. Confirm your password.",
    submit: "Turn off",
  },
};

function passwordError(code: string | undefined, fallback?: string): string {
  return code === "INVALID_PASSWORD"
    ? "Password is incorrect."
    : (fallback ?? "Something went wrong");
}

/** Formats the base32 secret in groups of 4 for typing into an app. */
function groupKey(key: string): string {
  return key.replace(/(.{4})/g, "$1 ").trim();
}

function PasswordStep({
  flow,
  onDone,
}: {
  flow: Flow;
  onDone: (password: string) => Promise<string | null>;
}) {
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<PasswordConfirmInput>({ resolver: zodResolver(passwordConfirmSchema) });
  const text = FLOW_TEXT[flow];

  async function onSubmit({ password }: PasswordConfirmInput) {
    const error = await onDone(password);
    if (error) setError("password", { message: error });
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="grid gap-4">
      <DialogHeader>
        <DialogTitle>{text.title}</DialogTitle>
        <DialogDescription>{text.description}</DialogDescription>
      </DialogHeader>
      <FormField id="tfa-password" label="Password" error={errors.password?.message}>
        <Input
          id="tfa-password"
          type="password"
          autoComplete="current-password"
          autoFocus
          {...fieldAria("tfa-password", errors.password?.message)}
          {...register("password")}
        />
      </FormField>
      <DialogFooter>
        <Button
          type="submit"
          variant={flow === "disable" ? "destructive" : "default"}
          disabled={isSubmitting}
        >
          {isSubmitting ? "Checking…" : text.submit}
        </Button>
      </DialogFooter>
    </form>
  );
}

function ScanStep({
  qrSvg,
  manualKey,
  onVerified,
}: {
  qrSvg: string;
  manualKey: string;
  onVerified: () => void;
}) {
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<{ code: string }>({ resolver: zodResolver(totpCodeSchema) });

  async function onSubmit({ code }: { code: string }) {
    const { error } = await authClient.twoFactor.verifyTotp({ code });
    if (error) {
      setError("code", { message: "That code is not valid. Try the latest one from your app." });
      return;
    }
    onVerified();
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="grid gap-4">
      <DialogHeader>
        <DialogTitle>Scan with your authenticator app</DialogTitle>
        <DialogDescription>
          Use Google Authenticator, Microsoft Authenticator, 1Password or similar, then enter the
          6-digit code it shows.
        </DialogDescription>
      </DialogHeader>
      {/* eslint-disable-next-line @next/next/no-img-element -- local data URI, nothing to optimise */}
      <img
        src={`data:image/svg+xml;utf8,${encodeURIComponent(qrSvg)}`}
        alt="QR code for your authenticator app"
        width={192}
        height={192}
        className="mx-auto rounded-md bg-white p-2"
      />
      <div className="grid gap-1 text-sm">
        <span className="text-muted-foreground">Can&apos;t scan? Enter this key instead:</span>
        <code
          data-testid="totp-manual-key"
          className="rounded-md bg-muted px-2 py-1 font-mono text-xs break-normal"
        >
          {groupKey(manualKey)}
        </code>
      </div>
      <FormField id="tfa-code" label="Code from the app" error={errors.code?.message}>
        <Input
          id="tfa-code"
          inputMode="numeric"
          autoComplete="one-time-code"
          autoFocus
          {...fieldAria("tfa-code", errors.code?.message)}
          {...register("code")}
        />
      </FormField>
      <DialogFooter>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Checking…" : "Turn on"}
        </Button>
      </DialogFooter>
    </form>
  );
}

function CodesStep({ backupCodes, onClose }: { backupCodes: string[]; onClose: () => void }) {
  const text = backupCodes.join("\n");

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Backup codes copied");
    } catch {
      toast.error("Could not copy. Select the codes and copy them yourself.");
    }
  }

  function download() {
    const url = URL.createObjectURL(new Blob([`WealthTrack backup codes\n\n${text}\n`]));
    const a = document.createElement("a");
    a.href = url;
    a.download = "wealthtrack-backup-codes.txt";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="grid gap-4">
      <DialogHeader>
        <DialogTitle>Save your backup codes</DialogTitle>
        <DialogDescription>
          Each code logs you in once if you lose your phone. They are shown only now — keep them
          somewhere safe.
        </DialogDescription>
      </DialogHeader>
      <ul
        aria-label="Backup codes"
        className="grid grid-cols-2 gap-2 rounded-md bg-muted p-3 font-mono text-sm"
      >
        {backupCodes.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
      <DialogFooter className="gap-2">
        <Button variant="outline" onClick={copy}>
          Copy
        </Button>
        <Button variant="outline" onClick={download}>
          Download
        </Button>
        <Button onClick={onClose}>I saved them</Button>
      </DialogFooter>
    </div>
  );
}

export function TwoFactorCard({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const [flow, setFlow] = useState<Flow | null>(null);
  const [step, setStep] = useState<Step>({ kind: "password" });

  function open(next: Flow) {
    setStep({ kind: "password" });
    setFlow(next);
  }

  function close() {
    setFlow(null);
    router.refresh();
  }

  async function withPassword(password: string): Promise<string | null> {
    if (flow === "enable") {
      const { data, error } = await authClient.twoFactor.enable({ password, method: "totp" });
      if (error || !data) return passwordError(error?.code, error?.message);
      if (data.method !== "totp") return "Could not start authenticator setup";
      const manualKey = new URL(data.totpURI).searchParams.get("secret") ?? "";
      const qrSvg = await QRCode.toString(data.totpURI, { type: "svg", margin: 0 });
      setStep({ kind: "scan", qrSvg, manualKey, backupCodes: data.backupCodes });
      return null;
    }
    if (flow === "regenerate") {
      const { data, error } = await authClient.twoFactor.generateBackupCodes({ password });
      if (error || !data) return passwordError(error?.code, error?.message);
      setStep({ kind: "codes", backupCodes: data.backupCodes });
      return null;
    }
    const { error } = await authClient.twoFactor.disable({ password });
    if (error) return passwordError(error.code, error.message);
    toast.success("Two-factor authentication is off");
    close();
    return null;
  }

  // Closing mid-enrolment leaves 2FA off (it turns on only after a code is confirmed).
  const dismissable = step.kind !== "codes";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Two-factor authentication
          <Badge variant={enabled ? "default" : "secondary"}>{enabled ? "On" : "Off"}</Badge>
        </CardTitle>
        <CardDescription>
          After your password, logging in also asks for a code from an authenticator app.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-2">
        {enabled ? (
          <>
            <Button variant="outline" onClick={() => open("regenerate")}>
              New backup codes
            </Button>
            <Button variant="destructive" onClick={() => open("disable")}>
              Turn off
            </Button>
          </>
        ) : (
          <Button onClick={() => open("enable")}>Turn on</Button>
        )}
      </CardContent>
      <Dialog
        open={flow !== null}
        onOpenChange={(next) => {
          if (!next && dismissable) close();
        }}
      >
        <DialogContent showCloseButton={dismissable}>
          {flow && step.kind === "password" ? (
            <PasswordStep key={flow} flow={flow} onDone={withPassword} />
          ) : null}
          {step.kind === "scan" ? (
            <ScanStep
              qrSvg={step.qrSvg}
              manualKey={step.manualKey}
              onVerified={() => {
                toast.success("Two-factor authentication is on");
                setStep({ kind: "codes", backupCodes: step.backupCodes });
              }}
            />
          ) : null}
          {step.kind === "codes" ? (
            <CodesStep backupCodes={step.backupCodes} onClose={close} />
          ) : null}
        </DialogContent>
      </Dialog>
    </Card>
  );
}
