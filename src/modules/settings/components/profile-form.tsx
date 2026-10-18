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
import { profileSchema, type ProfileInput } from "@/lib/auth-schemas";

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

export function ProfileForm({ name, email }: { name: string; email: string }) {
  return (
    <div className="grid gap-6">
      <NameForm name={name} email={email} />
    </div>
  );
}
