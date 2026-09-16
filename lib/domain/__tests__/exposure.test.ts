import { describe, expect, it } from "vitest";
import { qqqExposureAt, qqqLeverageOf, summarizeQqqExposure, valueOnOrBefore } from "../exposure";
import type { Transaction } from "../types";

describe("qqqLeverageOf", () => {
  it("레버리지 상품만 배수를 갖고 개별주는 0이다", () => {
    expect(qqqLeverageOf("QLD")).toBe(2);
    expect(qqqLeverageOf("TQQQ")).toBe(3);
    expect(qqqLeverageOf("QQQ")).toBe(1);
    expect(qqqLeverageOf("NVDA")).toBe(0);
    expect(qqqLeverageOf("SCHD")).toBe(0);
    expect(qqqLeverageOf("CASH.USD")).toBe(0);
  });
});

describe("summarizeQqqExposure", () => {
  it("비중에 배수를 곱해 더한다 — QLD 50%는 실효 100%", () => {
    const summary = summarizeQqqExposure("2026-09-17", 1000, [
      { symbolId: "QLD", valueKrw: 500 },
      { symbolId: "NVDA", valueKrw: 500 },
    ]);
    expect(summary.nominalPercent).toBeCloseTo(50, 9);
    expect(summary.effectivePercent).toBeCloseTo(100, 9);
  });

  it("배수가 0인 종목은 줄에 아예 안 나온다", () => {
    const summary = summarizeQqqExposure("2026-09-17", 1000, [
      { symbolId: "QLD", valueKrw: 100 },
      { symbolId: "NVDA", valueKrw: 900 },
    ]);
    expect(summary.lines.map((line) => line.symbolId)).toEqual(["QLD"]);
  });

  it("여러 레버리지 상품을 합산하고 노출이 큰 순으로 정렬한다", () => {
    const summary = summarizeQqqExposure("2026-09-17", 1000, [
      { symbolId: "QLD", valueKrw: 100 }, // 10% × 2 = 20%
      { symbolId: "TQQQ", valueKrw: 100 }, // 10% × 3 = 30%
    ]);
    expect(summary.lines.map((line) => line.symbolId)).toEqual(["TQQQ", "QLD"]);
    expect(summary.effectivePercent).toBeCloseTo(50, 9);
    expect(summary.nominalPercent).toBeCloseTo(20, 9);
  });

  it("평가금액이 0이면 0으로 나누지 않는다", () => {
    const summary = summarizeQqqExposure("2026-09-17", 0, [{ symbolId: "QLD", valueKrw: 100 }]);
    expect(summary.effectivePercent).toBe(0);
  });
});

describe("valueOnOrBefore", () => {
  const series = [
    { d: "2026-01-01", c: 1 },
    { d: "2026-01-05", c: 2 },
  ];

  it("그 날짜 이하의 마지막 값을 쓴다", () => {
    expect(valueOnOrBefore(series, "2026-01-07")?.c).toBe(2);
    expect(valueOnOrBefore(series, "2026-01-03")?.c).toBe(1);
  });

  it("시계열이 시작되기 전이면 null이다", () => {
    expect(valueOnOrBefore(series, "2025-12-31")).toBeNull();
    expect(valueOnOrBefore(undefined, "2026-01-07")).toBeNull();
  });
});

describe("qqqExposureAt", () => {
  const priceHistory = {
    QLD: [
      { d: "2026-01-01", c: 50 },
      { d: "2026-02-01", c: 100 },
    ],
  };
  const fxHistory = [
    { d: "2026-01-01", rate: 1000 },
    { d: "2026-02-01", rate: 1300 },
  ];
  const currencyOf = () => "USD" as const;

  function trade(at: string, shares: number): Transaction {
    return { id: at, at, accountId: "acc", symbolId: "QLD", side: "buy", shares, price: 50 };
  }

  it("그 시점까지의 거래만 반영하고 그날 종가·환율로 평가한다", () => {
    const summary = qqqExposureAt({
      at: "2026-02-10T00:00:00Z",
      transactions: [trade("2026-01-02T00:00:00Z", 10), trade("2026-03-01T00:00:00Z", 999)],
      priceHistory,
      fxHistory,
      totalKrw: 2_600_000,
      currencyOf,
    });

    // 10주 × $100 × 1300원 = 1,300,000원 → 총 2,600,000원의 50% → 배수 2배 → 100%
    expect(summary.lines).toHaveLength(1);
    expect(summary.lines[0].weightPercent).toBeCloseTo(50, 9);
    expect(summary.effectivePercent).toBeCloseTo(100, 9);
  });

  it("그 시점 종가를 모르는 종목은 추정하지 않고 뺀다", () => {
    const summary = qqqExposureAt({
      at: "2025-06-01T00:00:00Z",
      transactions: [trade("2025-05-01T00:00:00Z", 10)],
      priceHistory, // 2026-01-01부터라 2025년 종가는 없다
      fxHistory,
      totalKrw: 1_000_000,
      currencyOf,
    });
    expect(summary.lines).toHaveLength(0);
    expect(summary.effectivePercent).toBe(0);
  });

  it("전량 매도해 수량이 0이면 노출도 0이다", () => {
    const sell: Transaction = {
      id: "s", at: "2026-02-05T00:00:00Z", accountId: "acc", symbolId: "QLD", side: "sell", shares: 10, price: 100,
    };
    const summary = qqqExposureAt({
      at: "2026-02-10T00:00:00Z",
      transactions: [trade("2026-01-02T00:00:00Z", 10), sell],
      priceHistory,
      fxHistory,
      totalKrw: 1_000_000,
      currencyOf,
    });
    expect(summary.effectivePercent).toBe(0);
  });
});
