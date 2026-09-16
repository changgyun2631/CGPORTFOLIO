import { describe, expect, it } from "vitest";

import { buildAccountHistorySnapshots, fxRateAt, parseAccountHistoryTotals } from "../import-account-history.mjs";

const header = "일자,예탁자산,입금,출금";

describe("parseAccountHistoryTotals", () => {
  it("여러 CSV의 같은 날짜를 합산한다", () => {
    const csv1 = `${header}\n2026-01-01,1000000,0,0`;
    const csv2 = `${header}\n2026-01-01,500000,0,0`;
    const totals = parseAccountHistoryTotals([csv1, csv2]);
    expect(totals.get("2026-01-01")).toEqual({ totalKrw: 1_500_000, depositKrw: 0, withdrawalKrw: 0 });
  });

  it("날짜 형식이 아니거나 예탁자산이 0 이하인 행은 건너뛴다", () => {
    const csv = `${header}\n이상한날짜,1000000,0,0\n2026-01-01,0,0,0\n2026-01-02,500000,100000,0`;
    const totals = parseAccountHistoryTotals([csv]);
    expect(totals.has("이상한날짜")).toBe(false);
    expect(totals.has("2026-01-01")).toBe(false);
    expect(totals.get("2026-01-02")).toEqual({ totalKrw: 500_000, depositKrw: 100_000, withdrawalKrw: 0 });
  });

  it("헤더를 못 찾으면 에러를 던진다", () => {
    expect(() => parseAccountHistoryTotals(["a,b\n1,2"])).toThrow("헤더를 찾지 못했습니다");
  });
});

describe("fxRateAt", () => {
  const history = [
    { d: "2026-01-01", rate: 1300 },
    { d: "2026-01-10", rate: 1350 },
  ];

  it("정확히 그 날짜의 환율을 쓴다", () => {
    expect(fxRateAt(history, "2026-01-10")).toBe(1350);
  });

  it("데이터 사이 날짜는 이전 값을 쓴다", () => {
    expect(fxRateAt(history, "2026-01-05")).toBe(1300);
  });

  it("첫 데이터보다 이전 날짜는 첫 값을 쓴다", () => {
    expect(fxRateAt(history, "2025-01-01")).toBe(1300);
  });
});

describe("buildAccountHistorySnapshots", () => {
  it("CSV의 순입금 누적을 원금으로, 기존 스냅샷을 같은 날짜에 덮어쓴다", () => {
    const totals = new Map([
      ["2026-01-01", { totalKrw: 1_000_000, depositKrw: 1_000_000, withdrawalKrw: 0 }],
      ["2026-01-02", { totalKrw: 1_100_000, depositKrw: 0, withdrawalKrw: 0 }],
    ]);
    const snapshots = buildAccountHistorySnapshots(totals, {
      fxHistory: [{ d: "2026-01-01", rate: 1300 }],
      existingSnapshots: [],
      existingCashflows: [],
    });

    expect(snapshots).toHaveLength(2);
    expect(snapshots[0]).toMatchObject({ totalKrw: 1_000_000, principalKrw: 1_000_000, fxRate: 1300 });
    expect(snapshots[1]).toMatchObject({ totalKrw: 1_100_000, principalKrw: 1_000_000 });
  });

  it("CSV 구간 이후의 실제 외부 입출금만 원금에 이어 붙인다", () => {
    const totals = new Map([["2026-01-01", { totalKrw: 1_000_000, depositKrw: 1_000_000, withdrawalKrw: 0 }]]);
    const snapshots = buildAccountHistorySnapshots(totals, {
      fxHistory: [{ d: "2026-01-01", rate: 1300 }],
      existingSnapshots: [{ at: "2026-01-05T00:00:00Z", totalKrw: 1_200_000, fxRate: 1300 }],
      existingCashflows: [
        { at: "2026-01-03T00:00:00Z", type: "deposit", amount: 200_000, currency: "KRW", kind: "external" },
        // CSV 구간(2026-01-01) 이전 날짜의 입출금은 이미 CSV 누적에 반영돼 있다고 보고 무시한다.
        { at: "2025-12-31T00:00:00Z", type: "deposit", amount: 9_999_999, currency: "KRW", kind: "external" },
        // 원금에 안 잡는 성격(환전 등)은 무시한다.
        { at: "2026-01-04T00:00:00Z", type: "deposit", amount: 500_000, currency: "KRW", kind: "exchange" },
      ],
    });

    const last = snapshots.find((s) => s.at === "2026-01-05T00:00:00Z");
    expect(last?.principalKrw).toBe(1_200_000); // 1,000,000(CSV 누적) + 200,000(구간 후 외부 입금)
  });
});
