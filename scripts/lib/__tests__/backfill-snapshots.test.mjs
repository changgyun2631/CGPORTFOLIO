import { describe, expect, it } from "vitest";

import { backfillSnapshots } from "../backfill-snapshots.mjs";

const snapshots = [{ at: "2026-09-15T15:30:00+09:00", totalKrw: 1000, principalKrw: 800, fxRate: 1300 }];
const holdings = [{ symbolId: "QLD", shares: 10, currency: "USD" }];
const fxHistory = [
  { d: "2026-09-15", rate: 1300 },
  { d: "2026-09-16", rate: 1400 },
  { d: "2026-09-17", rate: 1400 },
];

describe("backfillSnapshots", () => {
  it("마지막 스냅샷 이후 날짜를 그날 종가와 환율로 채운다", () => {
    const prices = { QLD: [{ d: "2026-09-15", c: 100 }, { d: "2026-09-16", c: 110 }] };
    const { added } = backfillSnapshots({ snapshots, holdings, cash: { KRW: 500, USD: 2 }, prices, fxHistory });

    expect(added).toEqual([
      {
        at: "2026-09-16T15:30:00+09:00",
        // 10주 × 110달러 × 1400 + 원화 500 + 2달러 × 1400
        totalKrw: 10 * 110 * 1400 + 500 + 2 * 1400,
        principalKrw: 800,
        fxRate: 1400,
      },
    ]);
  });

  it("이미 있는 날짜는 다시 만들지 않는다", () => {
    const prices = { QLD: [{ d: "2026-09-15", c: 100 }, { d: "2026-09-16", c: 110 }] };
    const withDay = [...snapshots, { at: "2026-09-16T00:00:00Z", totalKrw: 1, principalKrw: 1, fxRate: 1 }];
    const { added } = backfillSnapshots({ snapshots: withDay, holdings, cash: { KRW: 0, USD: 0 }, prices, fxHistory });
    expect(added).toEqual([]);
  });

  it("마지막 스냅샷 이전 날짜는 건드리지 않는다", () => {
    const prices = { QLD: [{ d: "2026-09-10", c: 100 }] };
    const { added } = backfillSnapshots({ snapshots, holdings, cash: { KRW: 0, USD: 0 }, prices, fxHistory });
    expect(added).toEqual([]);
  });

  it("보유 종목의 종가가 없는 날은 지어내지 않고 건너뛴다", () => {
    // SCHD는 09-16 종가가 없다 — QLD만 있다고 그날 총액을 만들면 보유분이 통째로 빠진다.
    const prices = {
      QLD: [{ d: "2026-09-16", c: 110 }],
      SCHD: [{ d: "2026-08-01", c: 30 }],
    };
    const two = [...holdings, { symbolId: "SCHD", shares: 1, currency: "USD" }];
    const { added, skipped } = backfillSnapshots({ snapshots, holdings: two, cash: { KRW: 0, USD: 0 }, prices, fxHistory });

    expect(added).toEqual([]);
    expect(skipped[0]).toMatchObject({ date: "2026-09-16", reason: expect.stringContaining("SCHD") });
  });

  it("휴장일이면 그 이전 가장 가까운 종가·환율을 쓴다", () => {
    // 09-17은 QLD 종가가 없지만 SCHD 덕에 후보 날짜가 된다 — QLD는 09-16 종가로 본다.
    const prices = {
      QLD: [{ d: "2026-09-16", c: 110 }],
      SCHD: [{ d: "2026-09-15", c: 29 }, { d: "2026-09-17", c: 30 }],
    };
    const two = [...holdings, { symbolId: "SCHD", shares: 1, currency: "USD" }];
    const { added } = backfillSnapshots({ snapshots, holdings: two, cash: { KRW: 0, USD: 0 }, prices, fxHistory });

    expect(added.map((snapshot) => snapshot.at.slice(0, 10))).toEqual(["2026-09-16", "2026-09-17"]);
    expect(added[0].totalKrw).toBe((10 * 110 + 1 * 29) * 1400);
    expect(added[1].totalKrw).toBe((10 * 110 + 1 * 30) * 1400);
  });

  it("환율이 없는 날은 건너뛴다", () => {
    const prices = { QLD: [{ d: "2026-09-30", c: 110 }] };
    const { added, skipped } = backfillSnapshots({ snapshots, holdings, cash: { KRW: 0, USD: 0 }, prices, fxHistory });
    expect(added).toEqual([]);
    expect(skipped[0]).toMatchObject({ date: "2026-09-30", reason: "환율 없음" });
  });

  it("until을 주면 그 날짜까지만 채운다", () => {
    const prices = { QLD: [{ d: "2026-09-16", c: 110 }, { d: "2026-09-17", c: 120 }] };
    const { added } = backfillSnapshots({
      snapshots,
      holdings,
      cash: { KRW: 0, USD: 0 },
      prices,
      fxHistory,
      until: "2026-09-16",
    });
    expect(added.map((snapshot) => snapshot.at.slice(0, 10))).toEqual(["2026-09-16"]);
  });

  it("기준 스냅샷이 없으면 에러를 던진다", () => {
    expect(() => backfillSnapshots({ snapshots: [], holdings, cash: { KRW: 0, USD: 0 }, prices: {}, fxHistory })).toThrow(
      "스냅샷이 하나도 없습니다",
    );
  });
});
