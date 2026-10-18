// Categorical chart palette (dataviz reference instance), validated with validate_palette.js in its
// fixed slot order against our light and dark surfaces. Asset classes store the LIGHT hex; charts
// render `var(--viz-cat-N)` so dark mode gets its own validated step. Client-safe.

export const CATEGORICAL = [
  { slot: 1, name: "Blue", light: "#2a78d6", dark: "#3987e5" },
  { slot: 2, name: "Orange", light: "#eb6834", dark: "#d95926" },
  { slot: 3, name: "Aqua", light: "#1baf7a", dark: "#199e70" },
  { slot: 4, name: "Yellow", light: "#eda100", dark: "#c98500" },
  { slot: 5, name: "Magenta", light: "#e87ba4", dark: "#d55181" },
  { slot: 6, name: "Green", light: "#008300", dark: "#008300" },
  { slot: 7, name: "Violet", light: "#6250d6", dark: "#9085e9" },
  { slot: 8, name: "Red", light: "#e34948", dark: "#e66767" },
] as const;

const BY_HEX = new Map<string, number>(CATEGORICAL.map((c) => [c.light.toLowerCase(), c.slot]));

/** Palette slot of a stored colour, or null for a custom hex. */
export function paletteSlot(hex: string): number | null {
  return BY_HEX.get(hex.toLowerCase()) ?? null;
}

/** CSS colour for a stored class colour: theme-aware palette variable, else the custom hex. */
export function vizColor(hex: string): string {
  const slot = paletteSlot(hex);
  return slot ? `var(--viz-cat-${slot})` : hex;
}
