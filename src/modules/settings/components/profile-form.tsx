"use client";

import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { FormField, fieldAria } from "@/components/shared/form-field";
import { authClient } from "@/lib/auth-client";
import {
  PASSWORD_MIN,
  changePasswordSchema,
  profileSchema,
  type ChangePasswordInput,
  type ProfileInput,
} from "@/lib/auth-schemas";

function NameForm({ name, email }: { name: string; email: string }) {
  const router = useRouter();
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<ProfileInput>({ resolver: zodResolver(profileSchema), defaultValues: { name } });

  async function onSubmit(values: ProfileInput) {
    const { error } = await authClient.updateUser({ name: values.name });
    if (error) {
      toast.error(error.message ?? "Could not update your name");
      return;
    }
    reset(values);
    toast.success("Profile updated");
    router.refresh();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Profile</CardTitle>
        <CardDescription>Your name appears in the account menu.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} noValidate className="grid gap-4 sm:max-w-md">
          <FormField id="name" label="Name" error={errors.name?.message}>
            <Input
              id="name"
              autoComplete="name"
              {...fieldAria("name", errors.name?.message)}
              {...register("name")}
            />
          </FormField>
          <FormField id="email" label="Email" description="Email cannot be changed yet.">
            <Input
              id="email"
              value={email}
              readOnly
              disabled
              aria-describedby="email-description"
            />
          </FormField>
          <div>
            <Button type="submit" disabled={!isDirty || isSubmitting}>
              {isSubmitting ? "Saving…" : "Save profile"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function PasswordForm() {
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<ChangePasswordInput>({ resolver: zodResolver(changePasswordSchema) });

  async function onSubmit(values: ChangePasswordInput) {
    const { error } = await authClient.changePassword({
      currentPassword: values.currentPassword,
      newPassword: values.newPassword,
      revokeOtherSessions: true,
    });
    if (error) {
      const message =
        error.code === "INVALID_PASSWORD"
          ? "Current password is incorrect."
          : (error.message ?? "Could not change password");
      setError("currentPassword", { message });
      toast.error(message);
      return;
    }
    reset({ currentPassword: "", newPassword: "", confirmPassword: "" });
    toast.success("Password changed. Other devices were signed out.");
  }

  const fields = [
    { name: "currentPassword", label: "Current password", autoComplete: "current-password" },
    { name: "newPassword", label: "New password", autoComplete: "new-password" },
    { name: "confirmPassword", label: "Confirm new password", autoComplete: "new-password" },
  ] as const;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Password</CardTitle>
        <CardDescription>
          At least {PASSWORD_MIN} characters. Signs out your other devices.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} noValidate className="grid gap-4 sm:max-w-md">
          {fields.map((f) => {
            const error = errors[f.name]?.message;
            return (
              <FormField key={f.name} id={f.name} label={f.label} error={error}>
                <Input
                  id={f.name}
                  type="password"
                  autoComplete={f.autoComplete}
                  {...fieldAria(f.name, error)}
                  {...register(f.name)}
                />
              </FormField>
            );
          })}
          <div>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Changing…" : "Change password"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

export function ProfileForm({ name, email }: { name: string; email: string }) {
  return (
    <div className="grid gap-6">
      <NameForm name={name} email={email} />
      <PasswordForm />
    </div>
  );
}
