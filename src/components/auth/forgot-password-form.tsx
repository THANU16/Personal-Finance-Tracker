"use client";

import Link from "next/link";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField, fieldAria } from "@/components/shared/form-field";
import { authClient } from "@/lib/auth-client";
import { forgotPasswordSchema, type ForgotPasswordInput } from "@/lib/auth-schemas";

/** Same message whether or not the email has an account (no account enumeration). */
const RESET_SENT_MESSAGE =
  "If an account exists for that email, we have sent a link to reset the password. It works for 1 hour.";

export function ForgotPasswordForm() {
  const [sent, setSent] = useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ForgotPasswordInput>({ resolver: zodResolver(forgotPasswordSchema) });

  async function onSubmit({ email }: ForgotPasswordInput) {
    // Errors (e.g. rate limits) are not shown either: the answer must not depend on the email.
    await authClient.requestPasswordReset({ email, redirectTo: "/reset-password" });
    setSent(true);
  }

  if (sent) {
    return (
      <div className="grid gap-4">
        <p role="status" className="text-sm">
          {RESET_SENT_MESSAGE}
        </p>
        <Button variant="outline" render={<Link href="/login" />}>
          Back to log in
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="grid gap-4">
      <FormField id="email" label="Email" error={errors.email?.message}>
        <Input
          id="email"
          type="email"
          autoComplete="email"
          autoFocus
          {...fieldAria("email", errors.email?.message)}
          {...register("email")}
        />
      </FormField>
      <Button type="submit" disabled={isSubmitting} className="w-full">
        {isSubmitting ? "Sending…" : "Send reset link"}
      </Button>
      <p className="text-center text-sm text-muted-foreground">
        Remembered it?{" "}
        <Link href="/login" className="font-medium text-foreground underline underline-offset-4">
          Log in
        </Link>
      </p>
    </form>
  );
}
