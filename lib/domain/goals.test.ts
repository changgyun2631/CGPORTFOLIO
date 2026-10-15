import { describe, expect, it } from "vitest";

import { goalError, goalProgress } from "./goals";

describe("asset goal", () => {
  it("reports what is left and how far along we are", () => {
    expect(goalProgress(250, { amountKrw: 1000 })).toEqual({ remainingKrw: 750, percent: 25 });
    expect(goalProgress(1200, { amountKrw: 1000 }).remainingKrw).toBe(-200);
  });

  it("rejects bad amounts", () => {
    expect(goalError(0)).not.toBeNull();
    expect(goalError(Number.NaN)).not.toBeNull();
    expect(goalError(1e9)).toBeNull();
  });
});
