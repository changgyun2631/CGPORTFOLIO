import { describe, expect, it } from "vitest";

import { holdingTrends } from "./stat-trends";

describe("holdingTrends", () => {
  it("prices each day with current shares and carries the last close over holidays", () => {
    const { gain, winners } = holdingTrends(
      [
        { symbolId: "A", currency: "USD", shares: 2, averagePrice: 10, price: 13 },
        { symbolId: "B", currency: "KRW", shares: 1, averagePrice: 100, price: 90 },
      ],
      {
        A: [
          { d: "2026-10-01", c: 9 },
          { d: "2026-10-02", c: 12 },
          { d: "2026-10-03", c: 13 },
        ],
        // B는 10-02가 휴장 — 10-01 종가를 이어 쓴다.
        B: [
          { d: "2026-10-01", c: 110 },
          { d: "2026-10-03", c: 90 },
        ],
      },
      1000,
      30,
    );
    expect(gain).toEqual([-2000 + 10, 4000 + 10, 6000 - 10]);
    expect(winners).toEqual([1, 2, 1]);
  });
});
