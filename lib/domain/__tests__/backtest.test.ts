import { describe, expect, it } from "vitest";
import { runBacktest, type Allocation, type BacktestConfig } from "../backtest";
import type { Symbol } from "../types";

const qld: Symbol = { id: "QLD", name: "QLD", kind: "etf", currency: "USD", market: "US" };

function dailyPrices(start: string, days: number, priceAt: (i: number) => number) {
  const points: { d: string; c: number }[] = [];
  const startDate = new Date(`${start}T00:00:00Z`);
  for (let i = 0; i < days; i += 1) {
    const d = new Date(startDate);
    d.setUTCDate(d.getUTCDate() + i);
    points.push({ d: d.toISOString().slice(0, 10), c: priceAt(i) });
  }
  return points;
}

function fxFlat(start: string, days: number, rate: number) {
  const points: { d: string; rate: number }[] = [];
  const startDate = new Date(`${start}T00:00:00Z`);
  for (let i = 0; i < days; i += 1) {
    const d = new Date(startDate);
    d.setUTCDate(d.getUTCDate() + i);
    points.push({ d: d.toISOString().slice(0, 10), rate });
  }
  return points;
}

function baseConfig(overrides: Partial<BacktestConfig> = {}): BacktestConfig {
  const allocations: Allocation[] = [{ symbolId: "QLD", weight: 100 }];
  return {
    id: "b1",
    title: "test",
    summary: "",
    allocations,
    initialKrw: 10_000_000,
    ...overrides,
  };
}

describe("runBacktest — CAGR 적용 가능 여부", () => {
  it("초기 일시금만 있고 추가납입/인출이 없으면 CAGR을 적용한다", () => {
    const prices = { QLD: dailyPrices("2024-01-01", 400, () => 100) };
    const fx = fxFlat("2024-01-01", 400, 1300);
    const result = runBacktest(baseConfig(), prices, fx, [qld]);
    expect(result.cagrApplicable).toBe(true);
  });

  it("적립식(월 추가납입)이면 CAGR을 적용하지 않는다", () => {
    const prices = { QLD: dailyPrices("2024-01-01", 400, () => 100) };
    const fx = fxFlat("2024-01-01", 400, 1300);
    const result = runBacktest(
      baseConfig({ initialKrw: 0, monthlyContributionKrw: 500_000 }),
      prices,
      fx,
      [qld],
    );
    expect(result.cagrApplicable).toBe(false);
    // 초기 일시금 0인 적립식이라도 순증률은 계산 가능해야 한다
    expect(Number.isFinite(result.returnOnInvested)).toBe(true);
  });

  it("인출 시나리오면 CAGR을 적용하지 않는다", () => {
    const prices = { QLD: dailyPrices("2024-01-01", 400, () => 100) };
    const fx = fxFlat("2024-01-01", 400, 1300);
    const result = runBacktest(
      baseConfig({ monthlyWithdrawalKrw: 100_000 }),
      prices,
      fx,
      [qld],
    );
    expect(result.cagrApplicable).toBe(false);
  });
});

describe("runBacktest — 자금 소진 판정", () => {
  it("수수료 때문에 목표액에 몇 푼 못 미치는 것은 소진으로 오판하지 않는다", () => {
    // 가격이 충분히 커서 매달 인출해도 자산이 남지만, 수수료 때문에 아주 근소하게
    // 모자랄 수 있는 상황을 만든다. 초기금이 크고 인출액이 작으면 소진되지 않아야 한다.
    const prices = { QLD: dailyPrices("2024-01-01", 400, () => 100) };
    const fx = fxFlat("2024-01-01", 400, 1300);
    const result = runBacktest(
      baseConfig({ initialKrw: 100_000_000, monthlyWithdrawalKrw: 100_000 }),
      prices,
      fx,
      [qld],
    );
    expect(result.depletedAt).toBeNull();
  });

  it("자산이 실제로 바닥나면 depletedAt이 채워진다", () => {
    const prices = { QLD: dailyPrices("2024-01-01", 400, () => 100) };
    const fx = fxFlat("2024-01-01", 400, 1300);
    const result = runBacktest(
      baseConfig({ initialKrw: 1_000_000, monthlyWithdrawalKrw: 2_000_000 }),
      prices,
      fx,
      [qld],
    );
    expect(result.depletedAt).not.toBeNull();
  });
});

describe("runBacktest — 인출 시 과세", () => {
  it("세율이 있어도 원금 회수분에는 세금이 붙지 않는다 (가격 불변이면 차익 0)", () => {
    const prices = { QLD: dailyPrices("2024-01-01", 400, () => 100) };
    const fx = fxFlat("2024-01-01", 400, 1300);
    const result = runBacktest(
      baseConfig({ monthlyWithdrawalKrw: 500_000, withdrawalTaxRate: 0.22 }),
      prices,
      fx,
      [qld],
    );
    // 가격이 안 움직였으니 평가차익이 없다 -> 세금도 0에 가까워야 한다
    expect(result.taxPaidKrw).toBeCloseTo(0, 0);
  });

  it("가격이 올라 차익이 있으면 세금이 발생한다", () => {
    const prices = { QLD: dailyPrices("2024-01-01", 400, (i) => 100 * (1 + i * 0.01)) };
    const fx = fxFlat("2024-01-01", 400, 1300);
    const result = runBacktest(
      baseConfig({ monthlyWithdrawalKrw: 500_000, withdrawalTaxRate: 0.22 }),
      prices,
      fx,
      [qld],
    );
    expect(result.taxPaidKrw).toBeGreaterThan(0);
  });
});

describe("runBacktest — 리밸런싱 원가 승계", () => {
  it("리밸런싱 후에도 매입원가가 리셋되지 않아, 가격 상승분에 정상 과세된다", () => {
    const rising: Symbol = { id: "A", name: "A", kind: "etf", currency: "USD", market: "US" };
    const flat: Symbol = { id: "B", name: "B", kind: "etf", currency: "USD", market: "US" };
    const prices = {
      A: dailyPrices("2024-01-01", 500, (i) => 100 * (1 + i * 0.005)),
      B: dailyPrices("2024-01-01", 500, () => 100),
    };
    const fx = fxFlat("2024-01-01", 500, 1300);

    const withRebalance = runBacktest(
      baseConfig({
        allocations: [
          { symbolId: "A", weight: 50 },
          { symbolId: "B", weight: 50 },
        ],
        monthlyWithdrawalKrw: 300_000,
        withdrawalTaxRate: 0.22,
        rebalance: "monthly",
      }),
      prices,
      fx,
      [rising, flat],
    );

    // 리밸런싱이 있어도 세금이 0이 되면 안 된다 (원가가 매번 리셋된다면 차익이 사라져 세금도 0에 가까워짐)
    expect(withRebalance.taxPaidKrw).toBeGreaterThan(0);
  });
});

describe("runBacktest — 가격 이력 없는 종목 처리", () => {
  it("가격 이력이 1개 이하인 종목은 제외되고 비중이 재정규화된다", () => {
    const noHistory: Symbol = { id: "NEW", name: "NEW", kind: "etf", currency: "USD", market: "US" };
    const prices = {
      QLD: dailyPrices("2024-01-01", 400, () => 100),
      NEW: [{ d: "2024-01-01", c: 100 }],
    };
    const fx = fxFlat("2024-01-01", 400, 1300);
    const result = runBacktest(
      baseConfig({
        allocations: [
          { symbolId: "QLD", weight: 50 },
          { symbolId: "NEW", weight: 50 },
        ],
      }),
      prices,
      fx,
      [qld, noHistory],
    );
    expect(result.skipped).toEqual(["NEW"]);
    expect(result.finalKrw).toBeGreaterThan(0);
  });
});

describe("runBacktest — 배당 반영", () => {
  /** 주가는 제자리인데 배당만 쌓이는 종목. 커버드콜이 실제로 이런 모양이다. */
  const flatPrice = dailyPrices("2024-01-01", 400, () => 100);
  const withDividends = dailyPrices("2024-01-01", 400, (i) => 100 * (1 + i * 0.0005));
  const fx = fxFlat("2024-01-01", 400, 1300);

  it("배당 반영 가격을 주면 그쪽 성과를 쓰고 기여분을 남긴다", () => {
    const result = runBacktest(baseConfig(), { QLD: flatPrice }, fx, [qld], { QLD: withDividends });

    // 주가만 보면 제자리라 순증이 0 근처여야 하는데, 배당을 반영하면 늘어난다.
    expect(result.dividendContributionKrw).not.toBeNull();
    expect(result.dividendContributionKrw!).toBeGreaterThan(0);
    expect(result.finalKrw).toBeGreaterThan(10_000_000);
  });

  it("배당 반영 가격이 없으면 주가 기준으로 돌리고 기여분은 null이다", () => {
    const result = runBacktest(baseConfig(), { QLD: flatPrice }, fx, [qld]);
    expect(result.dividendContributionKrw).toBeNull();
  });

  it("일부 종목만 배당 반영 가격이 있으면 섞지 않고 null로 둔다", () => {
    // 한쪽만 배당을 반영하면 두 종목의 비교가 어긋나므로, 반쪽짜리 숫자를 만들지 않는다.
    const schd: Symbol = { id: "SCHD", name: "SCHD", kind: "etf", currency: "USD", market: "US" };
    const config = baseConfig({
      allocations: [
        { symbolId: "QLD", weight: 50 },
        { symbolId: "SCHD", weight: 50 },
      ],
    });
    const result = runBacktest(config, { QLD: flatPrice, SCHD: flatPrice }, fx, [qld, schd], { QLD: withDividends });
    expect(result.dividendContributionKrw).toBeNull();
  });
});
