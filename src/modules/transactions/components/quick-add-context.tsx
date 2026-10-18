"use client";

import * as React from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { TransactionDTO } from "@/modules/transactions/schemas";
import { QuickAddSheet } from "@/modules/transactions/components/quick-add-sheet";

export type QuickAddType = "expense" | "income" | "transfer";

export type QuickAddRequest =
  | { mode: "create"; type?: QuickAddType; accountId?: string; duplicateOf?: TransactionDTO }
  | { mode: "edit"; txn: TransactionDTO };

interface QuickAddContextValue {
  open: (request?: QuickAddRequest) => void;
}

const QuickAddContext = React.createContext<QuickAddContextValue | null>(null);

export function useQuickAdd(): QuickAddContextValue {
  const ctx = React.useContext(QuickAddContext);
  if (!ctx) throw new Error("useQuickAdd must be used inside <QuickAddProvider>");
  return ctx;
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) ||
    Boolean(target.closest("[role=dialog],[role=menu],[role=listbox]"))
  );
}

/** Global Quick add (docs/05 §1): one sheet for the app, opened by button or the N key. */
export function QuickAddProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = React.useState<{ open: boolean; request: QuickAddRequest }>({
    open: false,
    request: { mode: "create" },
  });
  const open = React.useCallback(
    (request: QuickAddRequest = { mode: "create" }) => setState({ open: true, request }),
    [],
  );

  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key.toLowerCase() !== "n" || e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
      if (isTypingTarget(e.target)) return;
      e.preventDefault();
      open();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const value = React.useMemo(() => ({ open }), [open]);
  return (
    <QuickAddContext value={value}>
      {children}
      <QuickAddSheet
        open={state.open}
        request={state.request}
        onOpenChange={(o) => setState((s) => ({ ...s, open: o }))}
      />
    </QuickAddContext>
  );
}

export function QuickAddButton({
  label = "Add",
  request,
  className,
}: {
  label?: string;
  request?: QuickAddRequest;
  className?: string;
}) {
  const { open } = useQuickAdd();
  return (
    <Button className={className} onClick={() => open(request)} title="Quick add (N)">
      <Plus aria-hidden /> {label}
    </Button>
  );
}
