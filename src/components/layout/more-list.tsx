"use client";

import { useSyncExternalStore, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronRight, LogOut, RefreshCw } from "lucide-react";
import { useTheme } from "next-themes";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { MORE_GROUPS } from "@/components/layout/nav";
import { initials, useLogOut } from "@/components/layout/user-menu";
import { cn } from "@/lib/utils";

// docs/07 §1 — More: grouped list (iOS settings style) for everything outside the tab bar.

// Text only: three labelled segments fit beside "Theme" at 360px.
const THEMES = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
] as const;

const noop = () => () => {};

function Group({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-2">
      {title ? (
        <h2 className="px-4 text-xs font-medium tracking-wide text-muted-foreground uppercase">
          {title}
        </h2>
      ) : null}
      <ul className="divide-y overflow-hidden rounded-xl border bg-card">{children}</ul>
    </section>
  );
}

const ROW = "flex min-h-12 w-full items-center gap-3 px-4 py-2 text-left text-base";

function ThemeRow() {
  const { theme = "system", setTheme } = useTheme();
  // The stored theme is only known in the browser; render nothing selected on the server.
  const mounted = useSyncExternalStore(
    noop,
    () => true,
    () => false,
  );
  return (
    <li className={cn(ROW, "justify-between")}>
      <span>Theme</span>
      <div role="group" aria-label="Theme" className="flex gap-1 rounded-lg bg-muted p-1">
        {THEMES.map((t) => {
          const active = mounted && theme === t.value;
          return (
            <button
              key={t.value}
              type="button"
              aria-pressed={active}
              onClick={() => setTheme(t.value)}
              className={cn(
                "flex min-h-11 items-center rounded-md px-3 text-sm text-muted-foreground",
                active && "bg-background text-foreground shadow-sm",
              )}
            >
              {t.label}
            </button>
          );
        })}
      </div>
    </li>
  );
}

export function MoreList({ name, email, unread }: { name: string; email: string; unread: number }) {
  const router = useRouter();
  const logOut = useLogOut();
  const [refreshing, startRefresh] = useTransition();

  return (
    <div className="grid gap-6">
      <Group>
        <li className={ROW}>
          <Avatar className="size-10" aria-hidden>
            <AvatarFallback>{initials(name, email)}</AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <div className="truncate font-medium">{name}</div>
            <div className="truncate text-sm text-muted-foreground">{email}</div>
          </div>
        </li>
      </Group>

      {MORE_GROUPS.map((group) => (
        <Group key={group.title} title={group.title}>
          {group.items.map((item) => (
            <li key={item.href}>
              <Link href={item.href} className={ROW}>
                <item.icon className="size-5 text-muted-foreground" aria-hidden />
                <span className="flex-1">{item.title}</span>
                {item.href === "/notifications" && unread ? (
                  <span className="min-w-6 rounded-full bg-destructive px-2 text-center text-xs leading-6 font-semibold text-white">
                    <span className="sr-only">Unread: </span>
                    {unread > 99 ? "99+" : unread}
                  </span>
                ) : null}
                <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
              </Link>
            </li>
          ))}
        </Group>
      ))}

      <Group title="App">
        <ThemeRow />
        <li>
          <button
            type="button"
            className={ROW}
            disabled={refreshing}
            onClick={() => startRefresh(() => router.refresh())}
          >
            <RefreshCw
              className={cn("size-5 text-muted-foreground", refreshing && "animate-spin")}
              aria-hidden
            />
            <span className="flex-1">{refreshing ? "Refreshing…" : "Refresh data"}</span>
          </button>
        </li>
      </Group>

      <Group>
        <li>
          <button
            type="button"
            className={cn(ROW, "text-destructive")}
            onClick={() => void logOut()}
          >
            <LogOut className="size-5" aria-hidden />
            Log out
          </button>
        </li>
      </Group>
    </div>
  );
}
