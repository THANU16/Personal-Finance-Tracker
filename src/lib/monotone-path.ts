// SVG path helpers for charts drawn on Recharts scales (docs/04 §24.8). Pure.

export type XY = readonly [x: number, y: number];

const sign = (v: number) => (v < 0 ? -1 : 1);

/** Tangent at the middle point (Steffen 1990, as d3.curveMonotoneX and Recharts "monotone"). */
function slope3(x0: number, y0: number, x1: number, y1: number, x2: number, y2: number): number {
  const h0 = x1 - x0;
  const h1 = x2 - x1;
  const s0 = (y1 - y0) / (h0 || (h1 < 0 ? -0 : 0));
  const s1 = (y2 - y1) / (h1 || (h0 < 0 ? -0 : 0));
  const p = (s0 * h1 + s1 * h0) / (h0 + h1);
  return (sign(s0) + sign(s1)) * Math.min(Math.abs(s0), Math.abs(s1), 0.5 * Math.abs(p)) || 0;
}

/** End tangent from the neighbouring one. */
function slope2(x0: number, y0: number, x1: number, y1: number, t: number): number {
  const h = x1 - x0;
  return h ? ((3 * (y1 - y0)) / h - t) / 2 : t;
}

const n = (v: number) => Math.round(v * 10) / 10;

/**
 * Smooth curve through every point that never overshoots between them (monotone in x), continuing
 * an existing path when `continued` (no leading "M"). Points must be in ascending x.
 */
export function monotonePath(points: readonly XY[], continued = false): string {
  if (points.length === 0) return "";
  const [fx, fy] = points[0]!;
  let d = continued ? `L${n(fx)},${n(fy)}` : `M${n(fx)},${n(fy)}`;
  if (points.length === 1) return d;
  if (points.length === 2) return `${d}L${n(points[1]![0])},${n(points[1]![1])}`;
  const t: number[] = new Array(points.length).fill(0);
  for (let i = 1; i < points.length - 1; i++) {
    const [x0, y0] = points[i - 1]!;
    const [x1, y1] = points[i]!;
    const [x2, y2] = points[i + 1]!;
    t[i] = slope3(x0, y0, x1, y1, x2, y2);
  }
  t[0] = slope2(points[0]![0], points[0]![1], points[1]![0], points[1]![1], t[1]!);
  const last = points.length - 1;
  t[last] = slope2(
    points[last - 1]![0],
    points[last - 1]![1],
    points[last]![0],
    points[last]![1],
    t[last - 1]!,
  );
  for (let i = 0; i < last; i++) {
    const [x0, y0] = points[i]!;
    const [x1, y1] = points[i + 1]!;
    const dx = (x1 - x0) / 3;
    d += `C${n(x0 + dx)},${n(y0 + dx * t[i]!)} ${n(x1 - dx)},${n(y1 - dx * t[i + 1]!)} ${n(x1)},${n(y1)}`;
  }
  return d;
}

/** Step line holding each y until the next x (Recharts "stepAfter"), optionally extended to `toX`. */
export function stepAfterPoints(points: readonly XY[], toX?: number): XY[] {
  const out: XY[] = [];
  points.forEach(([x, y], i) => {
    if (i > 0) out.push([x, points[i - 1]![1]]);
    out.push([x, y]);
  });
  const lastPoint = points.at(-1);
  if (lastPoint && toX !== undefined && toX > lastPoint[0]) out.push([toX, lastPoint[1]]);
  return out;
}

/** Straight segments through the points. */
export function linePath(points: readonly XY[], continued = false): string {
  return points.map(([x, y], i) => `${i === 0 && !continued ? "M" : "L"}${n(x)},${n(y)}`).join("");
}
