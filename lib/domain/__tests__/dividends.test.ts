import { describe, expect, it } from "vitest";
import { monthsOfYear, summarizeDividends } from "../dividends";
import type { Holding } from "../portfolio";
import type { DividendPayment, FxRate, Symbol } from "../types";

const fx: FxRate = { pair: "USD/KRW", rate: 1300, prevRate: 1290, asOf: "2024-06-01" };
const schd: Symbol = { id: "SCHD", name: "SCHD", kind: "etf", currency: "USD", market: "US", dividendYield: 3.5 };

function holding(overrides: Partial<Holding>): Holding {
  return {
    symbolId: "SCHD",
    name: "SCHD",
    currency: "USD",
    market: "US",
    kind: "etf",
    shares: 10,
    averagePrice: 80,
    price: 80,
    prevClose: 80,
    valueKrw: 1_040_000,
    prevValueKrw: 1_040_000,
    dayChangeKrw: 0,
    dayChangePercent: 0,
    costKrw: 1_040_000,
    estimatedExitFeeKrw: 0,
    totalGainKrw: 0,
    totalGainPercent: 0,
    weight: 100,
    byAccount: [],
    ...overrides,
  };
}

describe("summarizeDividends", () => {
  it("실지급 내역이 있으면 최근 12개월 합계를 연간 예상으로 쓰고 추정치를 섞지 않는다", () => {
    const now = new Date("2024-06-15T00:00:00+09:00");
    const dividends: DividendPayment[] = [
      { id: "d1", at: "2024-01-15", accountId: "acc1", symbolId: "SCHD", amount: 20, currency: "USD" },
      { id: "d2", at: "2024-04-15", accountId: "acc1", symbolId: "SCHD", amount: 20, currency: "USD" },
    ];
    const summary = summarizeDividends(dividends, [schd], [holding({})], fx, now);
    expect(summary.forecastIsEstimated).toBe(false);
    expect(summary.forecastKrw).toBeCloseTo(40 * 1300);
  });

  it("지급 이력이 없는 보유 종목은 배당률 추정치로 예상액에 더해진다", () => {
    const now = new Date("2024-06-15T00:00:00+09:00");
    const summary = summarizeDividends([], [schd], [holding({ valueKrw: 1_000_000 })], fx, now);
    expect(summary.forecastIsEstimated).toBe(true);
    expect(summary.forecastKrw).toBeCloseTo((1_000_000 * 3.5) / 100);
  });

  it("현금 보유분은 배당 예상 대상에서 제외된다", () => {
    const now = new Date("2024-06-15T00:00:00+09:00");
    const cashHolding = holding({ symbolId: "CASH.KRW", kind: "cash", valueKrw: 5_000_000 });
    const summary = summarizeDividends([], [schd], [cashHolding], fx, now);
    expect(summary.forecastKrw).toBe(0);
  });

  it("연도별/종목별 집계가 올바르게 나뉜다", () => {
    const dividends: DividendPayment[] = [
      { id: "d1", at: "2023-12-15", accountId: "acc1", symbolId: "SCHD", amount: 10, currency: "USD" },
      { id: "d2", at: "2024-01-15", accountId: "acc1", symbolId: "SCHD", amount: 10, currency: "USD" },
    ];
    const summary = summarizeDividends(dividends, [schd], [], fx, new Date("2024-06-01"));
    const years = summary.byYear.map((y) => y.year).sort();
    expect(years).toEqual(["2023", "2024"]);
    expect(summary.bySymbol[0].count).toBe(2);
  });
});

describe("monthsOfYear", () => {
  it("빈 달도 0원으로 채워 12개월을 만든다", () => {
    const dividends: DividendPayment[] = [
      { id: "d1", at: "2024-03-15", accountId: "acc1", symbolId: "SCHD", amount: 10, currency: "USD" },
    ];
    const summary = summarizeDividends(dividends, [schd], [], fx, new Date("2024-06-01"));
    const months = monthsOfYear(summary, "2024");
    expect(months).toHaveLength(12);
    expect(months[2].month).toBe("2024-03");
    expect(months[2].totalKrw).toBeGreaterThan(0);
    expect(months[0].totalKrw).toBe(0);
  });
});
