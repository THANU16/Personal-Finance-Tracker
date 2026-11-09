"use client";

import * as React from "react";

// Last used categories per kind (owner request): shown first in the phone category picker.
export const RECENT_CATEGORIES_KEY = "wt-quick-add-categories";
const RECENT_MAX = 8;
type RecentCategories = Partial<Record<"expense" | "income", string[]>>;

function readRaw(): string {
  try {
    return localStorage.getItem(RECENT_CATEGORIES_KEY) ?? "{}";
  } catch {
    return "{}";
  }
}

function parse(raw: string): RecentCategories {
  try {
    return JSON.parse(raw) as RecentCategories;
  } catch {
    return {};
  }
}

const noopSubscribe = () => () => {};

/** Recent category ids for a kind; empty on the server so hydration agrees. */
export function useRecentCategoryIds(kind: "expense" | "income"): string[] {
  const stored = React.useSyncExternalStore(noopSubscribe, readRaw, () => "{}");
  return React.useMemo(() => parse(stored)[kind] ?? [], [stored, kind]);
}

export function rememberCategoryId(kind: "expense" | "income", categoryId: string) {
  try {
    const recent = parse(readRaw());
    const list = [categoryId, ...(recent[kind] ?? []).filter((id) => id !== categoryId)];
    recent[kind] = list.slice(0, RECENT_MAX);
    localStorage.setItem(RECENT_CATEGORIES_KEY, JSON.stringify(recent));
  } catch {
    // storage unavailable: the recent row is a convenience only
  }
}
