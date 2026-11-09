/**
 * Calculator keypad for amounts on phones (owner request, 2026-11-09; docs/05 §3, docs/07 §5).
 * The user types a short sum such as `1250+340` or `4500/3`; it is evaluated exactly in minor
 * units (BigInt), × and ÷ before + and −, each step rounded half away from zero to the currency's
 * minor unit. Pure: no DOM, no React.
 */

export const KEYPAD_OPERATORS = ["+", "-", "*", "/"] as const;
export type KeypadOperator = (typeof KEYPAD_OPERATORS)[number];
/** Digits, ".", an operator, "back" (delete one) or "clear". */
export type KeypadKey =
  | "0"
  | "1"
  | "2"
  | "3"
  | "4"
  | "5"
  | "6"
  | "7"
  | "8"
  | "9"
  | "00"
  | "."
  | KeypadOperator
  | "back"
  | "clear";

const MAX_INTEGER_DIGITS = 12;
const isOperator = (c: string): c is KeypadOperator =>
  (KEYPAD_OPERATORS as readonly string[]).includes(c);

/** The number being typed at the end of the expression ("" right after an operator). */
function lastNumber(expr: string): string {
  const m = /[0-9.]*$/.exec(expr);
  return m ? m[0] : "";
}

/** The expression after one key press; invalid presses leave it unchanged. */
export function applyKeypadKey(expr: string, key: KeypadKey, digits: number): string {
  if (key === "clear") return "";
  if (key === "back") return expr.slice(0, -1);
  if (isOperator(key)) {
    if (expr === "") return expr; // no leading operator: amounts start with a number
    const last = expr.slice(-1);
    if (isOperator(last)) return expr.slice(0, -1) + key;
    if (last === ".") return expr.slice(0, -1) + key;
    return expr + key;
  }
  const num = lastNumber(expr);
  if (key === ".") {
    if (digits === 0 || num.includes(".")) return expr;
    return expr + (num === "" ? "0." : ".");
  }
  // digits ("0"-"9", "00")
  const [intPart = "", frac] = num.split(".");
  if (frac !== undefined) {
    const room = digits - frac.length;
    if (room <= 0) return expr;
    return expr + key.slice(0, room);
  }
  if (intPart === "0") {
    // "0" followed by a digit replaces the zero; "00" after "0" stays "0".
    return key === "0" || key === "00" ? expr : expr.slice(0, -1) + key;
  }
  if (intPart === "" && key === "00") return expr + "0";
  if (intPart.length + key.length > MAX_INTEGER_DIGITS) return expr;
  return expr + key;
}

/** True when the expression has an operator between two numbers (show "= result"). */
export function isCalculation(expr: string): boolean {
  return /[0-9.][+\-*/][0-9.]/.test(expr);
}

function toScaled(token: string, digits: number): bigint | null {
  if (!/^(\d+\.?\d*|\.\d+)$/.test(token)) return null;
  const [i = "0", f = ""] = token.split(".");
  if (f.length > digits) return null;
  return BigInt((i || "0") + f.padEnd(digits, "0"));
}

/** n / d rounded half away from zero (d > 0 or d < 0, never 0). */
function divRound(n: bigint, d: bigint): bigint {
  const negative = n < 0n !== d < 0n;
  const an = n < 0n ? -n : n;
  const ad = d < 0n ? -d : d;
  const q = (an * 2n + ad) / (ad * 2n);
  return negative ? -q : q;
}

/**
 * Evaluates the expression to minor units. A trailing operator or "." is ignored. Returns null
 * when it is empty, malformed, divides by zero or exceeds the safe integer range.
 */
export function evaluateAmountExpression(expr: string, digits: number): number | null {
  let e = expr.trim();
  while (e && (isOperator(e.slice(-1)) || e.endsWith("."))) e = e.slice(0, -1);
  if (!e) return null;
  const tokens = e.match(/\d+\.?\d*|\.\d+|[+\-*/]/g);
  if (!tokens || tokens.join("") !== e || tokens.length % 2 === 0) return null;
  const scale = 10n ** BigInt(digits);

  const terms: bigint[] = [];
  const signs: ("+" | "-")[] = [];
  let current = toScaled(tokens[0]!, digits);
  if (current === null) return null;
  for (let i = 1; i < tokens.length; i += 2) {
    const op = tokens[i]!;
    const value = toScaled(tokens[i + 1]!, digits);
    if (!isOperator(op) || value === null) return null;
    if (op === "*") current = divRound(current * value, scale);
    else if (op === "/") {
      if (value === 0n) return null;
      current = divRound(current * scale, value);
    } else {
      terms.push(current);
      signs.push(op);
      current = value;
    }
  }
  terms.push(current);
  let total = terms[0]!;
  for (let i = 0; i < signs.length; i++) {
    total = signs[i] === "+" ? total + terms[i + 1]! : total - terms[i + 1]!;
  }
  const n = Number(total);
  return Number.isSafeInteger(n) ? n : null;
}

/** Minor units → the plain text the keypad starts from (159000, 2 → "1590"; 12345 → "123.45"). */
export function minorToKeypad(minor: number | null, digits: number): string {
  if (minor === null || Number.isNaN(minor) || minor <= 0) return "";
  if (digits === 0) return String(minor);
  const s = String(minor).padStart(digits + 1, "0");
  const int = s.slice(0, -digits);
  const frac = s.slice(-digits).replace(/0+$/, "");
  return frac ? `${int}.${frac}` : int;
}
