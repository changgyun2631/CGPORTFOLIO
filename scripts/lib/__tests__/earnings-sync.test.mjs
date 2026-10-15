import { describe, expect, it } from "vitest";

import { fiscalPeriod, mergeEarnings } from "../earnings-sync.mjs";

describe("mergeEarnings", () => {
  const row = { symbol: "AMD", date: "2026-11-03", time: "time-after-hours", fiscalQuarterEnding: "Sep/2026", epsForecast: "$1.20" };

  it("adds an auto event with SEC source and rewrites it when the date moves", () => {
    const once = mergeEarnings([], [row], { AMD: "0000002488" });
    expect(once).toEqual([
      {
        id: "earn-AMD-2026-09",
        date: "2026-11-03",
        title: "AMD 실적 발표",
        kind: "earnings",
        symbolId: "AMD",
        note: "미국 장 마감 후 · 예상 EPS $1.20",
        resultSource: { provider: "sec", period: "2026-09", cik: "0000002488" },
      },
    ]);
    const moved = mergeEarnings(once, [{ ...row, date: "2026-11-05" }], { AMD: "0000002488" });
    expect(moved).toHaveLength(1);
    expect(moved[0].date).toBe("2026-11-05");
  });

  it("leaves a hand-written event for the same quarter alone", () => {
    const manual = { id: "ev-1", date: "2026-11-04", title: "AMD", kind: "earnings", symbolId: "AMD", resultSource: { provider: "sec", period: "2026-09", cik: "x" } };
    expect(mergeEarnings([manual], [row], {})).toEqual([manual]);
  });

  it("reads Nasdaq fiscal quarter labels", () => {
    expect(fiscalPeriod("Oct/2026")).toBe("2026-10");
    expect(fiscalPeriod("")).toBeNull();
  });
});
