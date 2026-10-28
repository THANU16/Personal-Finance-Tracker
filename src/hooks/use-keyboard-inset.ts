import * as React from "react";

// How far the on-screen keyboard covers the bottom of the layout viewport, in px (0 when closed).
// iOS keeps fixed elements on the layout viewport, so bars must lift by this much to stay visible.

function read(): number {
  const vv = window.visualViewport;
  if (!vv) return 0;
  return Math.max(0, Math.round(window.innerHeight - (vv.height + vv.offsetTop)));
}

function subscribe(onChange: () => void) {
  const vv = window.visualViewport;
  if (!vv) return () => {};
  vv.addEventListener("resize", onChange);
  vv.addEventListener("scroll", onChange);
  return () => {
    vv.removeEventListener("resize", onChange);
    vv.removeEventListener("scroll", onChange);
  };
}

export function useKeyboardInset(): number {
  return React.useSyncExternalStore(subscribe, read, () => 0);
}
