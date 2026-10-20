import { ImageResponse } from "next/og";

// PWA icons drawn in code (no binary files in git): a rising bar chart on the brand blue.
// `maskable` keeps the mark inside the 80% safe zone and fills the whole square.
const BRAND = "#2a78d6";

export function renderAppIcon(size: number, opts: { maskable?: boolean } = {}): ImageResponse {
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
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
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
    </div>,
    { width: size, height: size, headers: { "Cache-Control": "public, max-age=86400" } },
  );
}
