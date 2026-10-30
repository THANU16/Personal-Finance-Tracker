// iOS launch screens (docs/07 §7). iOS picks the `apple-touch-startup-image` whose media query
// matches the device exactly, so every current iPhone screen is listed (CSS points × pixel ratio).
const SCREENS = [
  { w: 375, h: 667, dpr: 2 }, // SE 2nd/3rd gen, 8
  { w: 375, h: 812, dpr: 3 }, // X, XS, 11 Pro, 12/13 mini
  { w: 414, h: 896, dpr: 2 }, // XR, 11
  { w: 414, h: 896, dpr: 3 }, // XS Max, 11 Pro Max
  { w: 390, h: 844, dpr: 3 }, // 12, 13, 14, 16e
  { w: 428, h: 926, dpr: 3 }, // 12/13 Pro Max, 14 Plus
  { w: 393, h: 852, dpr: 3 }, // 14 Pro, 15, 15 Pro, 16
  { w: 430, h: 932, dpr: 3 }, // 14 Pro Max, 15 Plus/Pro Max, 16 Plus
  { w: 402, h: 874, dpr: 3 }, // 16 Pro, 17, 17 Pro
  { w: 420, h: 912, dpr: 3 }, // Air
  { w: 440, h: 956, dpr: 3 }, // 16 Pro Max, 17 Pro Max
] as const;

export type SplashTheme = "light" | "dark";

export interface SplashScreen {
  /** File name under /splash/, e.g. `1179x2556-dark.png`. */
  file: string;
  width: number;
  height: number;
  theme: SplashTheme;
  media: string;
}

export const SPLASH_SCREENS: SplashScreen[] = SCREENS.flatMap(({ w, h, dpr }) =>
  (["light", "dark"] as const).map((theme) => ({
    file: `${w * dpr}x${h * dpr}-${theme}.png`,
    width: w * dpr,
    height: h * dpr,
    theme,
    media:
      `(device-width: ${w}px) and (device-height: ${h}px) and (-webkit-device-pixel-ratio: ${dpr})` +
      ` and (orientation: portrait) and (prefers-color-scheme: ${theme})`,
  })),
);
