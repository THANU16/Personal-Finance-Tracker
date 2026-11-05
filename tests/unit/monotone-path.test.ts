import { describe, expect, it } from "vitest";
import { linePath, monotonePath, stepAfterPoints } from "@/lib/monotone-path";

describe("monotonePath", () => {
  it("passes through every point and keeps flat runs flat", () => {
    const d = monotonePath([
      [0, 10],
      [10, 10],
      [20, 0],
    ]);
    expect(d.startsWith("M0,10")).toBe(true);
    expect(d).toContain(" 10,10C");
    expect(d.endsWith(" 20,0")).toBe(true);
    // Flat first segment: both control points at y 10 (no overshoot above the plateau).
    expect(d).toMatch(/^M0,10C3\.3,10 6\.7,10 10,10/);
  });

  it("handles 0, 1 and 2 points and continuing a path", () => {
    expect(monotonePath([])).toBe("");
    expect(monotonePath([[1, 2]])).toBe("M1,2");
    expect(
      monotonePath([
        [0, 0],
        [5, 5],
      ]),
    ).toBe("M0,0L5,5");
    expect(monotonePath([[1, 2]], true)).toBe("L1,2");
  });
});

describe("stepAfterPoints / linePath", () => {
  it("holds each value until the next point and extends to the end", () => {
    const pts = stepAfterPoints(
      [
        [0, 5],
        [10, 2],
      ],
      15,
    );
    expect(pts).toEqual([
      [0, 5],
      [10, 5],
      [10, 2],
      [15, 2],
    ]);
    expect(linePath(pts)).toBe("M0,5L10,5L10,2L15,2");
  });
});
