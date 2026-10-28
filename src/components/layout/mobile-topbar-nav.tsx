"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { mobileParent } from "@/components/layout/nav";

// docs/07 §1 — compact top bar (< md): back chevron to the parent page, and a small title that
// fades in once the page's large title (its <h1>) has scrolled under the bar.

const BAR_PX = 56;

/** Text of the page <h1> while it is scrolled out of view under the bar, else null. */
function useCollapsedTitle(pathname: string): string | null {
  const [title, setTitle] = useState<string | null>(null);

  useEffect(() => {
    const main = document.querySelector("main");
    if (!main) return;
    let io: IntersectionObserver | undefined;

    const watch = (h1: HTMLHeadingElement) => {
      io?.disconnect();
      io = new IntersectionObserver(
        ([entry]) => {
          const above = !entry.isIntersecting && entry.boundingClientRect.top < BAR_PX;
          setTitle(above ? (h1.textContent ?? "").trim() || null : null);
        },
        { rootMargin: `-${BAR_PX}px 0px 0px 0px` },
      );
      io.observe(h1);
    };

    // The heading can stream in after the shell, so wait for it.
    let h1 = main.querySelector("h1");
    if (h1) watch(h1);
    const mo = new MutationObserver(() => {
      const next = main.querySelector("h1");
      if (next && next !== h1) {
        h1 = next;
        watch(next);
      }
    });
    mo.observe(main, { childList: true, subtree: true });
    return () => {
      mo.disconnect();
      io?.disconnect();
      setTitle(null);
    };
  }, [pathname]);

  return title;
}

function Nav({ pathname }: { pathname: string }) {
  const parent = mobileParent(pathname);
  const title = useCollapsedTitle(pathname);
  return (
    <>
      {parent ? (
        <Link
          href={parent.href}
          className="-ml-2 flex min-h-11 min-w-11 items-center gap-0.5 rounded-lg pr-2 text-base text-primary"
        >
          <ChevronLeft className="size-6" aria-hidden />
          <span className="max-w-28 truncate">{parent.label}</span>
        </Link>
      ) : null}
      {/* Visual duplicate of the page's <h1>, so hidden from assistive tech */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-28 truncate text-center text-base font-semibold transition-opacity duration-200 motion-reduce:transition-none"
        style={{ opacity: title ? 1 : 0 }}
      >
        {title}
      </span>
    </>
  );
}

function ActiveNav() {
  return <Nav pathname={usePathname()} />;
}

export function MobileTopbarNav() {
  return (
    <div className="flex min-w-0 flex-1 items-center md:hidden">
      <Suspense fallback={null}>
        <ActiveNav />
      </Suspense>
    </div>
  );
}
