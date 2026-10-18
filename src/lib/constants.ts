// Client-safe constants.

/** Currencies offered in pickers (any valid ISO code is accepted by the server). */
export const COMMON_CURRENCIES = [
  "LKR",
  "USD",
  "EUR",
  "GBP",
  "INR",
  "AUD",
  "CAD",
  "SGD",
  "AED",
  "JPY",
] as const;

export const LOCALES = [
  { value: "en-LK", label: "English (Sri Lanka)" },
  { value: "en-US", label: "English (United States)" },
  { value: "en-GB", label: "English (United Kingdom)" },
  { value: "en-IN", label: "English (India)" },
  { value: "en-AU", label: "English (Australia)" },
] as const;

export const HIDE_AMOUNTS_STORAGE_KEY = "wt-hide-amounts";
