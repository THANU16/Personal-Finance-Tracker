// Live digit grouping for amount inputs on phones (docs/07 §4: thousands separators while typing).
// Display only: the text still goes through parseMoneyToMinor, which ignores the commas.

export interface TypingState {
  text: string;
  /** Caret index in `text`. */
  caret: number;
}

const isSignificant = (ch: string) => /[0-9.-]/.test(ch);

/**
 * Regroups a typed number as "1,234,567.89" and keeps the caret after the same digit.
 * Drops anything but digits, one decimal point and a leading minus; decimals are not grouped.
 */
export function groupWhileTyping(text: string, caret: number): TypingState {
  // How many significant characters sit before the caret: the caret goes back after as many.
  let before = 0;
  for (let i = 0; i < Math.min(caret, text.length); i++) if (isSignificant(text[i])) before++;

  let sign = "";
  let whole = "";
  let frac: string | null = null;
  let kept = 0; // significant characters kept so far
  let caretKept = 0; // of those, how many were before the caret
  let seen = 0;
  for (const ch of text) {
    if (!isSignificant(ch)) continue;
    seen++;
    let keep = true;
    if (ch === "-") keep = kept === 0 && sign === "";
    else if (ch === ".") keep = frac === null;
    if (!keep) continue;
    kept++;
    if (seen <= before) caretKept++;
    if (ch === "-") sign = "-";
    else if (ch === ".") frac = "";
    else if (frac === null) whole += ch;
    else frac += ch;
  }

  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const out = sign + grouped + (frac === null ? "" : `.${frac}`);

  let pos = 0;
  let count = 0;
  while (pos < out.length && count < caretKept) {
    if (isSignificant(out[pos])) count++;
    pos++;
  }
  return { text: out, caret: pos };
}

/** Groups a finished value ("21000.00" → "21,000.00"). */
export function groupDigits(text: string): string {
  return groupWhileTyping(text, text.length).text;
}
