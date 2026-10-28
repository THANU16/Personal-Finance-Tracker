"use client";

import * as React from "react";
import { useIsMobile } from "@/hooks/use-mobile";

// docs/07 §4 — phone forms: the focused field stays visible above the keyboard, Enter moves to the
// next field ("next" key) and the last field submits ("done" key). md+: a plain <form>.

const FIELD =
  "input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=file]):not([type=submit]):not([type=button]):not(:disabled), textarea:not(:disabled)";

function fields(form: HTMLFormElement): HTMLElement[] {
  return Array.from(form.querySelectorAll<HTMLElement>(FIELD)).filter(
    (el) => el.offsetParent !== null && el.getAttribute("aria-hidden") !== "true",
  );
}

export function KeyboardSafeForm({
  children,
  onKeyDown,
  onFocus,
  ...props
}: React.ComponentProps<"form">) {
  const isMobile = useIsMobile();
  const ref = React.useRef<HTMLFormElement>(null);

  // Label the keyboard's return key; recomputed when fields appear or disappear.
  React.useEffect(() => {
    const form = ref.current;
    if (!isMobile || !form) return;
    const label = () => {
      const list = fields(form);
      list.forEach((el, i) => {
        if (el.tagName === "TEXTAREA" || el.dataset.enterkeyhintSet === "own") return;
        if (el.hasAttribute("enterkeyhint") && el.dataset.enterkeyhintSet !== "auto") {
          el.dataset.enterkeyhintSet = "own";
          return;
        }
        el.setAttribute("enterkeyhint", i === list.length - 1 ? "done" : "next");
        el.dataset.enterkeyhintSet = "auto";
      });
    };
    label();
    const mo = new MutationObserver(label);
    mo.observe(form, { childList: true, subtree: true });
    return () => mo.disconnect();
  }, [isMobile]);

  return (
    <form
      {...props}
      ref={ref}
      onFocus={(e) => {
        onFocus?.(e);
        if (!isMobile) return;
        const target = e.target as HTMLElement;
        if (!target.matches(FIELD)) return;
        // Wait for the keyboard to finish opening, then centre the field in what is left.
        window.setTimeout(
          () => target.scrollIntoView({ block: "center", behavior: "smooth" }),
          300,
        );
      }}
      onKeyDown={(e) => {
        onKeyDown?.(e);
        if (!isMobile || e.defaultPrevented || e.key !== "Enter" || e.nativeEvent.isComposing) {
          return;
        }
        const target = e.target as HTMLElement;
        if (target.tagName === "TEXTAREA" || !target.matches(FIELD)) return;
        const list = fields(e.currentTarget);
        const i = list.indexOf(target);
        if (i === -1) return;
        e.preventDefault();
        if (i < list.length - 1) list[i + 1].focus();
        else e.currentTarget.requestSubmit();
      }}
    >
      {children}
    </form>
  );
}
