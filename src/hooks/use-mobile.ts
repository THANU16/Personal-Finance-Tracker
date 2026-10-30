import * as React from "react";

const MOBILE_BREAKPOINT = 768;
const QUERY = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`;

function subscribe(onChange: () => void) {
  const mql = window.matchMedia(QUERY);
  mql.addEventListener("change", onChange);
  return () => mql.removeEventListener("change", onChange);
}

/** True below 768px. Subscribes to the media query instead of setting state in an effect. */
export function useIsMobile() {
  return React.useSyncExternalStore(
    subscribe,
    () => window.matchMedia(QUERY).matches,
    () => false,
  );
}

/**
 * Like `useIsMobile`, but `null` until hydrated (the server cannot know the width). Use it to
 * render both variants with CSS (`md:hidden` / `max-md:hidden`) before hydration, so phones get
 * the phone layout in the server HTML and nothing shifts when React takes over.
 */
export function useIsMobileOrUnknown(): boolean | null {
  return React.useSyncExternalStore(
    subscribe,
    () => window.matchMedia(QUERY).matches,
    () => null,
  );
}
