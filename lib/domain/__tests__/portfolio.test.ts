import { describe, expect, it } from "vitest";
import { buildCashBalances, buildPortfolio, buildPositions } from "../portfolio";
import type { Account, CashFlow, DividendPayment, FxRate, Quote, Symbol, Transaction } from "../types";

const account: Account = { id: "acc1", name: "위탁", kind: "위탁", currency: "KRW" };
const symbol: Symbol = { id: "QLD", name: "QLD", kind: "etf", currency: "USD", market: "US" };

function tx(overrides: Partial<Transaction>): Transaction {
  return {
    id: overrides.id ?? "tx",
    at: "2024-01-01T00:00:00+09:00",
    accountId: "acc1",
    symbolId: "QLD",
    side: "buy",
    shares: 1,
    price: 100,
    ...overrides,
  };
}

describe("buildPositions", () => {
  it("이동평균법으로 평단을 계산한다", () => {
    const [position] = buildPositions([
      tx({ id: "1", shares: 10, price: 100 }),
      tx({ id: "2", shares: 10, price: 200 }),
    ]);
    expect(position.shares).toBe(20);
    expect(position.averagePrice).toBe(150);
    expect(position.costBasis).toBe(3000);
  });

  it("보유수량보다 많이 매도하면 보유분까지만 처리한다", () => {
    const [position] = buildPositions([
      tx({ id: "1", side: "buy", shares: 5, price: 100 }),
      tx({ id: "2", side: "sell", shares: 999, price: 120 }),
    ]);
    expect(position.shares).toBe(0);
    expect(position.costBasis).toBe(0);
    // 실현손익은 실제 보유했던 5주분만 인정된다: (120-100)*5 = 100
    expect(position.realized).toBe(100);
  });

  it("전량 매도 후 재매수하면 새 평단으로 다시 시작한다", () => {
    const [position] = buildPositions([
      tx({ id: "1", side: "buy", shares: 10, price: 100 }),
      tx({ id: "2", side: "sell", shares: 10, price: 150 }),
      tx({ id: "3", side: "buy", shares: 5, price: 300 }),
    ]);
    expect(position.shares).toBe(5);
    expect(position.averagePrice).toBe(300);
    expect(position.realized).toBe(500); // (150-100)*10
  });

  it("수수료는 매수 시 원가에 더하고 매도 시 실현손익에서 뺀다", () => {
    const [position] = buildPositions([
      tx({ id: "1", side: "buy", shares: 10, price: 100, fee: 10 }),
      tx({ id: "2", side: "sell", shares: 10, price: 100, fee: 5 }),
    ]);
    // 매수원가 1010, 매도대금 1000, 원가차감 1010, 수수료 5 => 실현손익 -15
    expect(position.realized).toBe(-15);
  });
});

describe("buildCashBalances", () => {
  const fxRateAt = () => 1300;

  it("입금은 늘리고 매수는 줄인다", () => {
    const cashflows: CashFlow[] = [
      { id: "cf1", at: "2024-01-01", accountId: "acc1", type: "deposit", amount: 1_000_000, currency: "KRW" },
    ];
    const balances = buildCashBalances([account], [symbol], [], cashflows, [], fxRateAt);
    expect(balances).toEqual([{ accountId: "acc1", currency: "KRW", amount: 1_000_000 }]);
  });

  it("예수금이 음수가 될 수 있다 (입금 없이 매수한 경우)", () => {
    const transactions: Transaction[] = [tx({ id: "1", shares: 1, price: 100 })];
    const balances = buildCashBalances([account], [symbol], transactions, [], [], fxRateAt);
    const usd = balances.find((b) => b.currency === "USD");
    expect(usd?.amount).toBeLessThan(0);
    expect(usd?.amount).toBeCloseTo(-100);
  });

  it("배당은 예수금을 늘린다", () => {
    const dividends: DividendPayment[] = [
      { id: "d1", at: "2024-01-01", accountId: "acc1", symbolId: "QLD", amount: 50, currency: "USD" },
    ];
    const balances = buildCashBalances([account], [symbol], [], [], dividends, fxRateAt);
    expect(balances).toEqual([{ accountId: "acc1", currency: "USD", amount: 50 }]);
  });

  it("계좌 통화와 다른 통화의 입금은 그 시점 환율로 환산된다", () => {
    const usdAccount: Account = { id: "acc2", name: "달러계좌", kind: "위탁", currency: "USD" };
    const cashflows: CashFlow[] = [
      { id: "cf1", at: "2024-01-01", accountId: "acc2", type: "deposit", amount: 130_000, currency: "KRW" },
    ];
    const balances = buildCashBalances([usdAccount], [symbol], [], cashflows, [], () => 1300);
    expect(balances).toEqual([{ accountId: "acc2", currency: "USD", amount: 100 }]);
  });
});

describe("buildPortfolio", () => {
  const fx: FxRate = { pair: "USD/KRW", rate: 1300, prevRate: 1290, asOf: "2024-01-02" };
  const fxRateAt = () => 1300;

  it("통화 혼합: KRW 계좌에서 USD 종목을 매수해도 원화 총액에 정상 환산된다", () => {
    const cashflows: CashFlow[] = [
      { id: "cf1", at: "2024-01-01", accountId: "acc1", type: "deposit", amount: 200_000, currency: "KRW" },
    ];
    // KRW 계좌인데 USD 종목을 매수 -> USD 예수금이 음수로 생김. 이건 데이터 오류 상황을 가정한 것이 아니라
    // 계좌 통화와 무관하게 심볼 통화 기준으로 예수금이 나뉜다는 걸 보여주는 케이스.
    const transactions: Transaction[] = [tx({ id: "1", shares: 1, price: 100 })];
    const quotes: Quote[] = [{ symbolId: "QLD", price: 110, prevClose: 105, currency: "USD", asOf: "2024-01-02" }];

    const view = buildPortfolio({
      accounts: [account],
      symbols: [symbol],
      transactions,
      cashflows,
      dividends: [],
      quotes,
      fx,
      fxRateAt,
    });

    const holding = view.holdings.find((h) => h.symbolId === "QLD");
    expect(holding).toBeTruthy();
    expect(holding!.valueKrw).toBeCloseTo(1 * 110 * 1300);
    expect(view.totals.symbolCount).toBeGreaterThan(0);
  });

  it("비중 합계는 100에 가깝다", () => {
    const symbol2: Symbol = { id: "TQQQ", name: "TQQQ", kind: "etf", currency: "USD", market: "US" };
    const cashflows: CashFlow[] = [
      { id: "cf1", at: "2024-01-01", accountId: "acc1", type: "deposit", amount: 10_000_000, currency: "KRW" },
    ];
    const transactions: Transaction[] = [
      tx({ id: "1", symbolId: "QLD", shares: 10, price: 100 }),
      tx({ id: "2", symbolId: "TQQQ", shares: 5, price: 50 }),
    ];
    const quotes: Quote[] = [
      { symbolId: "QLD", price: 100, prevClose: 100, currency: "USD", asOf: "2024-01-02" },
      { symbolId: "TQQQ", price: 50, prevClose: 50, currency: "USD", asOf: "2024-01-02" },
    ];

    const view = buildPortfolio({
      accounts: [account],
      symbols: [symbol, symbol2],
      transactions,
      cashflows,
      dividends: [],
      quotes,
      fx,
      fxRateAt,
    });

    const totalWeight = view.holdings.reduce((sum, h) => sum + h.weight, 0);
    expect(totalWeight).toBeCloseTo(100, 5);
  });
});
