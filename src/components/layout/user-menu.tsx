"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { LogOut, Settings } from "lucide-react";
import { toast } from "sonner";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { authClient } from "@/lib/auth-client";

function initials(name: string, email: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = parts.length ? parts.slice(0, 2).map((p) => p[0]) : [email[0]];
  return letters.join("").toUpperCase();
}

export function UserMenu({ name, email }: { name: string; email: string }) {
  const router = useRouter();

  async function logOut() {
    const { error } = await authClient.signOut();
    if (error) {
      toast.error(error.message ?? "Could not log out");
      return;
    }
    router.replace("/login");
    router.refresh();
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size="icon" className="rounded-full" />}>
        {/* Named by its content (not aria-label) so the visible initials never contradict the name. */}
        <span className="sr-only">Account menu</span>
        <Avatar className="size-8" aria-hidden>
          <AvatarFallback>{initials(name, email)}</AvatarFallback>
        </Avatar>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-56">
        <DropdownMenuGroup>
          <DropdownMenuLabel>
            <div className="truncate text-sm font-medium text-foreground">{name}</div>
            <div className="truncate text-xs font-normal text-muted-foreground">{email}</div>
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem render={<Link href="/settings" />}>
          <Settings aria-hidden /> Settings
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => void logOut()}>
          <LogOut aria-hidden /> Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
