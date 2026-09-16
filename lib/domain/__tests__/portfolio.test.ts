import { describe, expect, it } from "vitest";
import {
  annotateTradesWithRealized,
  applyPositionBasis,
  buildCashBalances,
  buildCashFlowLedger,
  buildPortfolio,
  buildPositions,
} from "../portfolio";
import type { Account, CashFlow, DividendPayment, FxRate, PositionBasis, Quote, Symbol, Transaction } from "../types";

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

  it("액면분할은 원가와 실현손익을 바꾸지 않고 수량과 평단만 조정한다", () => {
    const [position] = buildPositions([
      tx({ id: "1", shares: 10, price: 100 }),
      tx({ id: "2", action: "split", splitRatio: 2, shares: 20, price: 0 }),
    ]);
    expect(position.shares).toBe(20);
    expect(position.costBasis).toBe(1000);
    expect(position.averagePrice).toBe(50);
    expect(position.realized).toBe(0);
  });

  it("주식 이체출고는 보유원가만 줄이고 실현손익을 만들지 않는다", () => {
    const [position] = buildPositions([
      tx({ id: "1", shares: 10, price: 100 }),
      tx({ id: "2", action: "transfer", side: "sell", shares: 4, price: 150 }),
    ]);
    expect(position.shares).toBe(6);
    expect(position.costBasis).toBe(600);
    expect(position.realized).toBe(0);
  });

  it("현재잔고 기준값이 불완전한 과거 원장의 수량과 원가를 대체한다", () => {
    const basis: PositionBasis[] = [
      { at: "2024-02-01", accountId: "acc1", symbolId: "QLD", shares: 7, averagePrice: 80, costBasis: 560, estimatedExitFeeRate: 0.002 },
    ];
    const positions = applyPositionBasis(buildPositions([tx({ id: "1", shares: 5, price: 100 })]), basis);
    expect(positions[0]).toMatchObject({ shares: 7, averagePrice: 80, costBasis: 560, estimatedExitFeeRate: 0.002 });
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

  it("액면분할과 주식 이체는 예수금을 움직이지 않는다", () => {
    const balances = buildCashBalances(
      [account],
      [symbol],
      [
        tx({ id: "1", action: "split", splitRatio: 2, shares: 20, price: 50 }),
        tx({ id: "2", action: "transfer", shares: 2, price: 100 }),
      ],
      [],
      [],
      fxRateAt,
    );
    expect(balances).toEqual([]);
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

  it("평가손익에 현재잔고 원가와 예상 매도수수료를 반영한다", () => {
    const positionBasis: PositionBasis[] = [
      { at: "2024-01-02", accountId: "acc1", symbolId: "QLD", shares: 10, averagePrice: 80, costBasis: 800, estimatedExitFeeRate: 0.01 },
    ];
    const view = buildPortfolio({
      accounts: [account],
      symbols: [symbol],
      transactions: [],
      cashflows: [],
      dividends: [],
      positionBasis,
      quotes: [{ symbolId: "QLD", price: 100, prevClose: 100, currency: "USD", asOf: "2024-01-02" }],
      fx,
      fxRateAt,
    });
    expect(view.totals.gainKrw).toBe((1000 - 800 - 10) * 1300);
    expect(view.totals.estimatedExitFeeKrw).toBe(10 * 1300);
  });

  it("원금은 외부 입출금만 포함하고 환전·수익·보정은 제외한다", () => {
    const cashflows: CashFlow[] = [
      { id: "external", at: "2024-01-01", accountId: "acc1", type: "deposit", amount: 1_000_000, currency: "KRW", kind: "external" },
      { id: "exchange", at: "2024-01-01", accountId: "acc1", type: "withdraw", amount: 100_000, currency: "KRW", kind: "exchange" },
      { id: "adjustment", at: "2024-01-01", accountId: "acc1", type: "deposit", amount: 50_000, currency: "KRW", kind: "adjustment" },
    ];
    const view = buildPortfolio({ accounts: [account], symbols: [], transactions: [], cashflows, dividends: [], quotes: [], fx, fxRateAt });
    expect(view.totals.principalKrw).toBe(1_000_000);
  });

  it("실제 현금 입출금으로 확정한 원금은 불완전한 거래원장 합계보다 우선한다", () => {
    const cashflows: CashFlow[] = [
      { id: "external", at: "2024-01-01", accountId: "acc1", type: "deposit", amount: 1_000_000, currency: "KRW", kind: "external" },
    ];
    const view = buildPortfolio({
      accounts: [account],
      symbols: [],
      transactions: [],
      cashflows,
      dividends: [],
      quotes: [],
      fx,
      fxRateAt,
      principalKrw: 750_000,
    });
    expect(view.totals.principalKrw).toBe(750_000);
  });
});

describe("buildCashFlowLedger", () => {
  const fxRateAt = () => 1300;

  it("입금·출금을 시간순으로 누적해 전/후 잔액을 매긴다", () => {
    const cashflows: CashFlow[] = [
      { id: "cf1", at: "2024-01-01", accountId: "acc1", type: "deposit", amount: 1000, currency: "KRW" },
      { id: "cf2", at: "2024-02-01", accountId: "acc1", type: "withdraw", amount: 300, currency: "KRW" },
    ];
    const [first, second] = buildCashFlowLedger([account], cashflows, fxRateAt);
    expect(first.balanceBefore).toBe(0);
    expect(first.balanceAfter).toBe(1000);
    expect(second.balanceBefore).toBe(1000);
    expect(second.balanceAfter).toBe(700);
  });

  it("순서가 뒤섞여 들어와도 날짜순으로 정렬해 누적한다", () => {
    const cashflows: CashFlow[] = [
      { id: "cf2", at: "2024-02-01", accountId: "acc1", type: "deposit", amount: 500, currency: "KRW" },
      { id: "cf1", at: "2024-01-01", accountId: "acc1", type: "deposit", amount: 1000, currency: "KRW" },
    ];
    const ledger = buildCashFlowLedger([account], cashflows, fxRateAt);
    expect(ledger.map((e) => e.id)).toEqual(["cf1", "cf2"]);
    expect(ledger[1].balanceAfter).toBe(1500);
  });

  it("달러 계좌에 원화로 입금하면 그 시점 환율로 환산돼 달러 잔액에 쌓인다", () => {
    const usdAccount: Account = { id: "acc2", name: "달러계좌", kind: "위탁", currency: "USD" };
    const cashflows: CashFlow[] = [
      { id: "cf1", at: "2024-01-01", accountId: "acc2", type: "deposit", amount: 130_000, currency: "KRW" },
    ];
    const [entry] = buildCashFlowLedger([usdAccount], cashflows, () => 1300);
    expect(entry.bucketCurrency).toBe("USD");
    expect(entry.balanceAfter).toBeCloseTo(100);
  });

  it("계좌와 통화가 다르면 별도로 누적된다", () => {
    const cashflows: CashFlow[] = [
      { id: "cf1", at: "2024-01-01", accountId: "acc1", type: "deposit", amount: 1000, currency: "KRW" },
      { id: "cf2", at: "2024-01-02", accountId: "acc1", type: "deposit", amount: 50, currency: "USD" },
    ];
    const ledger = buildCashFlowLedger([account], cashflows, fxRateAt);
    // KRW 계좌인데 달러로 입금하면 달러 버킷이 따로 생긴다 — KRW 잔액과 섞이지 않는다.
    expect(ledger[1].bucketCurrency).toBe("USD");
    expect(ledger[1].balanceBefore).toBe(0);
    expect(ledger[1].balanceAfter).toBe(50);
  });
});

describe("annotateTradesWithRealized", () => {
  it("매수 거래는 실현손익이 항상 0이다", () => {
    const [result] = annotateTradesWithRealized([tx({ id: "1", side: "buy", shares: 10, price: 100 })]);
    expect(result).toMatchObject({ side: "buy", shares: 10, price: 100, realized: 0 });
  });

  it("매도 거래는 buildPositions와 똑같은 실현손익을 낸다", () => {
    const transactions = [
      tx({ id: "1", side: "buy", shares: 10, price: 100 }),
      tx({ id: "2", side: "sell", shares: 10, price: 150 }),
    ];
    const [position] = buildPositions(transactions);
    const annotated = annotateTradesWithRealized(transactions);
    const sell = annotated.find((a) => a.id === "2")!;
    expect(sell.realized).toBeCloseTo(position.realized); // (150-100)*10 = 500
    expect(sell.realized).toBeCloseTo(500);
  });

  it("수수료는 실현손익에서 뺀다", () => {
    const transactions = [
      tx({ id: "1", side: "buy", shares: 10, price: 100, fee: 10 }),
      tx({ id: "2", side: "sell", shares: 10, price: 100, fee: 5 }),
    ];
    const annotated = annotateTradesWithRealized(transactions);
    // 매수원가 1010, 매도대금 1000 -> 원가차감 1010, 수수료 5 => 실현손익 -15 (portfolio.test.ts 위쪽 buildPositions 케이스와 동일)
    expect(annotated.find((a) => a.id === "2")!.realized).toBeCloseTo(-15);
  });

  it("여러 번 나눠 산 뒤 매도하면 그 시점 이동평균 기준으로 계산한다", () => {
    const transactions = [
      tx({ id: "1", side: "buy", shares: 10, price: 100 }),
      tx({ id: "2", side: "buy", shares: 10, price: 200 }), // 평단 150
      tx({ id: "3", side: "sell", shares: 5, price: 180 }),
    ];
    const annotated = annotateTradesWithRealized(transactions);
    // (180-150)*5 = 150
    expect(annotated.find((a) => a.id === "3")!.realized).toBeCloseTo(150);
  });

  it("이체와 액면분할은 결과에 안 나온다(화면에 매매 타점으로 안 보여줄 거래)", () => {
    const transactions = [
      tx({ id: "1", side: "buy", shares: 10, price: 100 }),
      tx({ id: "2", action: "transfer", side: "sell", shares: 4, price: 150 }),
      tx({ id: "3", action: "split", splitRatio: 2, shares: 12, price: 0 }),
    ];
    const annotated = annotateTradesWithRealized(transactions);
    expect(annotated.map((a) => a.id)).toEqual(["1"]);
  });

  it("계좌·종목이 다르면 서로 실현손익 계산이 섞이지 않는다", () => {
    const otherSymbol = "TQQQ";
    const transactions = [
      tx({ id: "1", side: "buy", shares: 10, price: 100 }),
      tx({ id: "2", symbolId: otherSymbol, side: "buy", shares: 5, price: 50 }),
      tx({ id: "3", side: "sell", shares: 10, price: 120 }), // QLD만: (120-100)*10=200
      tx({ id: "4", symbolId: otherSymbol, side: "sell", shares: 5, price: 40 }), // TQQQ만: (40-50)*5=-50
    ];
    const annotated = annotateTradesWithRealized(transactions);
    expect(annotated.find((a) => a.id === "3")!.realized).toBeCloseTo(200);
    expect(annotated.find((a) => a.id === "4")!.realized).toBeCloseTo(-50);
  });
});
