/**
 * docs/03 — seeded asset classes, in display order. Colours are the validated categorical palette
 * in its fixed slot order (src/lib/viz-palette.ts), so adjacent classes stay distinguishable.
 */
export const SYSTEM_ASSET_CLASSES: readonly { name: string; color: string; legacyColor: string }[] =
  [
    { name: "Equity", color: "#2a78d6", legacyColor: "#2563eb" },
    { name: "Fixed Income", color: "#eb6834", legacyColor: "#059669" },
    { name: "Gold", color: "#1baf7a", legacyColor: "#ca8a04" },
    { name: "Crypto", color: "#eda100", legacyColor: "#9333ea" },
    { name: "Real Estate", color: "#e87ba4", legacyColor: "#ea580c" },
    { name: "Cash & Equivalents", color: "#008300", legacyColor: "#0891b2" },
    { name: "Other", color: "#6250d6", legacyColor: "#64748b" },
  ];
