import { describe, expect, it } from "vitest";

import { goalCurve, goalError, targetOn } from "./goals";

describe("goal curve", () => {
  const curve = goalCurve({ date: "2026-01-01", amountKrw: 100 }, [
    { date: "2026-01-21", amountKrw: 400 },
    { date: "2026-01-11", amountKrw: 200 },
  ]);

  it("grows by a constant daily rate between saved goals", () => {
    expect(curve.map((p) => p.date)).toEqual(["2026-01-01", "2026-01-11", "2026-01-21"]);
    expect(targetOn(curve, "2026-01-06")).toBeCloseTo(100 * Math.SQRT2);
    expect(targetOn(curve, "2026-01-11")).toBe(200);
    expect(targetOn(curve, "2026-01-16")).toBeCloseTo(200 * Math.SQRT2);
  });

  it("has no target outside the curve", () => {
    expect(targetOn(curve, "2025-12-31")).toBeNull();
    expect(targetOn(curve, "2026-01-22")).toBeNull();
    expect(goalCurve({ date: "2026-01-01", amountKrw: 100 }, [])).toEqual([]);
  });

  it("rejects bad input", () => {
    expect(goalError({ date: "2026-13-40", amountKrw: 1 })).not.toBeNull();
    expect(goalError({ date: "2026-10-01", amountKrw: 0 })).not.toBeNull();
    expect(goalError({ date: "2026-10-01", amountKrw: 1e9 })).toBeNull();
  });
});
