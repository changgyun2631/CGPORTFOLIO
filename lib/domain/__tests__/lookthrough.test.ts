import { describe, expect, it } from "vitest";
import { expandHoldings, groupBySector } from "../lookthrough";
import type { Holding } from "../portfolio";
import type { LookthroughTable, Symbol } from "../types";

const qld: Symbol = { id: "QLD", name: "QLD", kind: "etf", currency: "USD", market: "US", lookthroughId: "qqq" };
const schd: Symbol = { id: "SCHD", name: "SCHD", kind: "etf", currency: "USD", market: "US", lookthroughId: "schd" };
const cash: Symbol = { id: "CASH.KRW", name: "원화예수금", kind: "cash", currency: "KRW", market: "CASH" };

function holding(overrides: Partial<Holding>): Holding {
  return {
    symbolId: "QLD",
    name: "QLD",
    currency: "USD",
    market: "US",
    kind: "etf",
    shares: 10,
    averagePrice: 80,
    price: 80,
    prevClose: 80,
    valueKrw: 1_000_000,
    prevValueKrw: 1_000_000,
    dayChangeKrw: 0,
    dayChangePercent: 1,
    costKrw: 900_000,
    totalGainKrw: 100_000,
    totalGainPercent: 11,
    weight: 100,
    byAccount: [],
    ...overrides,
  };
}

const table: LookthroughTable = {
  qqq: [
    { ticker: "AAPL", name: "Apple", weight: 60, sector: "Tech" },
    { ticker: "MSFT", name: "Microsoft", weight: 40, sector: "Tech" },
  ],
  schd: [
    { ticker: "AAPL", name: "Apple", weight: 50, sector: "Tech" },
    { ticker: "XOM", name: "Exxon", weight: 50, sector: "Energy" },
  ],
};

describe("expandHoldings", () => {
  it("비중대로 금액을 나눈다", () => {
    const result = expandHoldings([holding({})], [qld], table);
    const apple = result.nodes.find((n) => n.ticker === "AAPL");
    expect(apple?.valueKrw).toBeCloseTo(600_000);
  });

  it("여러 ETF에 겹친 종목은 합산된다", () => {
    const holdings = [holding({}), holding({ symbolId: "SCHD", name: "SCHD", valueKrw: 500_000 })];
    const result = expandHoldings(holdings, [qld, schd], table);
    const apple = result.nodes.find((n) => n.ticker === "AAPL");
    // QLD에서 60만 + SCHD에서 25만 = 85만
    expect(apple?.valueKrw).toBeCloseTo(850_000);
    expect(apple?.sources).toHaveLength(2);
  });

  it("공시 비중 합이 100이 아니면 실제 합으로 정규화한다", () => {
    const skewedTable: LookthroughTable = {
      qqq: [
        { ticker: "AAPL", name: "Apple", weight: 30 },
        { ticker: "MSFT", name: "Microsoft", weight: 30 }, // 합 60
      ],
    };
    const result = expandHoldings([holding({ valueKrw: 1_000_000 })], [qld], skewedTable);
    const apple = result.nodes.find((n) => n.ticker === "AAPL");
    expect(apple?.valueKrw).toBeCloseTo(500_000); // 30/60 * 100만
  });

  it("펼칠 표가 없는 종목은 자기 자신으로 남고 unresolved가 늘어난다", () => {
    const noTableSymbol: Symbol = { id: "SOLO", name: "SOLO", kind: "stock", currency: "USD", market: "US" };
    const result = expandHoldings([holding({ symbolId: "SOLO", name: "SOLO" })], [noTableSymbol], {});
    expect(result.unresolved).toBe(1);
    expect(result.nodes[0].ticker).toBe("SOLO");
  });

  it("예수금은 펼칠 표가 없어도 unresolved로 세지 않는다", () => {
    const result = expandHoldings([holding({ symbolId: "CASH.KRW", name: "원화예수금" })], [cash], {});
    expect(result.unresolved).toBe(0);
  });

  it("비중 합이 totalKrw 기준 100에 가깝다", () => {
    const holdings = [holding({}), holding({ symbolId: "SCHD", name: "SCHD", valueKrw: 500_000 })];
    const result = expandHoldings(holdings, [qld, schd], table);
    const totalWeight = result.nodes.reduce((sum, n) => sum + n.weight, 0);
    expect(totalWeight).toBeCloseTo(100, 5);
  });
});

describe("groupBySector", () => {
  it("섹터가 없으면 미분류로 묶인다", () => {
    const result = expandHoldings([holding({ symbolId: "SOLO", name: "SOLO" })], [
      { id: "SOLO", name: "SOLO", kind: "stock", currency: "USD", market: "US" },
    ], {});
    const grouped = groupBySector(result.nodes);
    expect(grouped[0].sector).toBe("미분류");
  });

  it("섹터별로 금액이 합산된다", () => {
    const holdings = [holding({}), holding({ symbolId: "SCHD", name: "SCHD", valueKrw: 500_000 })];
    const result = expandHoldings(holdings, [qld, schd], table);
    const grouped = groupBySector(result.nodes);
    const tech = grouped.find((g) => g.sector === "Tech");
    const energy = grouped.find((g) => g.sector === "Energy");
    expect(tech).toBeTruthy();
    expect(energy).toBeTruthy();
    expect(tech!.valueKrw + energy!.valueKrw).toBeCloseTo(result.totalKrw);
  });
});
