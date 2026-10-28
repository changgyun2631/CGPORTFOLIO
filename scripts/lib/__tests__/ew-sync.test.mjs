import { describe, expect, it } from "vitest";

import { mergeEw, mondayOf, parseWeek } from "../ew-sync.mjs";

const cell = (symbols) => (symbols ? `<div class="cw-cell cw-has" data-symbols="${symbols}"></div>` : '<div class="cw-cell cw-empty"></div>');
const group = (bo, ac) => `<div class="cw-daycol cw-logogroup">${cell(bo)}${cell(ac)}`;
// 요일 5개 + 모바일용 중복 칸(요일 그룹 뒤에 또 붙는 칸은 무시해야 한다)
const html = `<div>${group("NSSC,CHKP", "AAPL")}${group("SHOP", "AMD,ANET")}${group("UBER", "")}${group("DIBS", "TXG")}${group("MRNA", "")}${cell("DUP")}</div>`;

describe("parseWeek", () => {
  it("maps cells to day and before/after-close, ignoring empty and duplicate cells", () => {
    const rows = parseWeek(html, "2026-11-02");
    expect(rows.filter((r) => r.date === "2026-11-02")).toEqual([
      { symbol: "NSSC", date: "2026-11-02", time: "bo" },
      { symbol: "CHKP", date: "2026-11-02", time: "bo" },
      { symbol: "AAPL", date: "2026-11-02", time: "ac" },
    ]);
    expect(rows.find((r) => r.symbol === "ANET")).toMatchObject({ date: "2026-11-03", time: "ac" });
    expect(rows.find((r) => r.symbol === "MRNA")).toMatchObject({ date: "2026-11-06", time: "bo" });
    expect(rows.some((r) => r.symbol === "DUP")).toBe(false);
  });
  it("returns nothing for a week without a list", () => {
    expect(parseWeek("<html></html>", "2026-12-21")).toEqual([]);
  });
  it("finds the Monday of any weekday", () => {
    expect(mondayOf("2026-10-28")).toBe("2026-10-26");
    expect(mondayOf("2026-11-01")).toBe("2026-10-26");
  });
});

describe("mergeEw", () => {
  const range = { today: "2026-11-02", until: "2026-11-08" };
  const row = { symbol: "AMD", date: "2026-11-03", time: "ac" };

  it("adds events, skips symbols already scheduled that day, drops vanished future ones, keeps the past", () => {
    const events = [
      { id: "earn-AMD-2026-09", date: "2026-11-03", title: "AMD 실적 발표", kind: "earnings", symbolId: "AMD" },
      { id: "ew-OLD-2026-11-04", date: "2026-11-04", title: "OLD 실적 발표", kind: "earnings", symbolId: "OLD" },
      { id: "ew-PAST-2026-10-28", date: "2026-10-28", title: "PAST 실적 발표", kind: "earnings", symbolId: "PAST" },
    ];
    const out = mergeEw(events, [row, { symbol: "PFE", date: "2026-11-03", time: "bo" }], range);
    expect(out.map((e) => e.id)).toEqual(["ew-PAST-2026-10-28", "earn-AMD-2026-09", "ew-PFE-2026-11-03"]);
    expect(out.at(-1)).toMatchObject({ note: "미국 장 시작 전", symbolId: "PFE", kind: "earnings" });
  });
});
