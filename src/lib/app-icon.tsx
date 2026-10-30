import { ImageResponse } from "next/og";

// PWA icons drawn in code (no binary files in git): a rising bar chart on the brand blue.
// `maskable` keeps the mark inside the 80% safe zone and fills the whole square.
const BRAND = "#2a78d6";

function iconElement(size: number, opts: { maskable?: boolean } = {}) {
  const inset = opts.maskable ? size * 0.2 : size * 0.14;
  const radius = opts.maskable ? 0 : size * 0.22;
  const bar = (h: number) => (
    <div
      style={{
        width: (size - inset * 2) / 5,
        height: (size - inset * 2) * h,
        background: "white",
        borderRadius: size * 0.03,
      }}
    />
  );
  return (
    <div
      style={{
        width: size,
        height: size,
        display: "flex",
        background: BRAND,
        borderRadius: radius,
        alignItems: "flex-end",
        justifyContent: "space-between",
        padding: inset,
      }}
    >
      {bar(0.38)}
      {bar(0.62)}
      {bar(0.88)}
    </div>
  );
}

export function renderAppIcon(size: number, opts: { maskable?: boolean } = {}): ImageResponse {
  return new ImageResponse(iconElement(size, opts), {
    width: size,
    height: size,
    headers: { "Cache-Control": "public, max-age=86400" },
  });
}

/** Light/dark app backgrounds (match `viewport.themeColor` in the root layout). */
export const SPLASH_BACKGROUND = { light: "#ffffff", dark: "#0a0a0a" } as const;

/**
 * iOS launch screen (docs/07 §7): the app background with the icon in the middle, so opening the
 * home-screen app never flashes white in dark mode. Sizes are device pixels.
 */
export function renderSplash(width: number, height: number, theme: "light" | "dark") {
  const icon = Math.round(width * 0.24);
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: SPLASH_BACKGROUND[theme],
      }}
    >
      {iconElement(icon)}
    </div>,
    { width, height, headers: { "Cache-Control": "public, max-age=86400" } },
  );
}
