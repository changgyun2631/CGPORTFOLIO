import { describe, expect, it } from "vitest";

import {
  validateAccounts,
  validateAll,
  validateBasisNotRegressing,
  validateCashFlows,
  validateDividends,
  validatePositionBasis,
  validateSnapshots,
  validateSymbols,
  validateTransactions,
} from "../validate.mjs";

const accounts = [{ id: "acc-1", name: "테스트계좌", kind: "위탁", currency: "USD" }];
const symbols = [
  { id: "QLD", name: "QLD", kind: "etf", currency: "USD", market: "US" },
  { id: "AAPL", name: "Apple", kind: "stock", currency: "USD", market: "US" },
];
const accountIds = new Set(accounts.map((a) => a.id));
const symbolIds = new Set(symbols.map((s) => s.id));

const validTransaction = {
  id: "tx-1",
  at: "2026-01-05T00:00:00Z",
  accountId: "acc-1",
  symbolId: "QLD",
  side: "buy",
  shares: 10,
  price: 100,
  fee: 1,
};

const validCashFlow = {
  id: "cf-1",
  at: "2026-01-01T00:00:00Z",
  accountId: "acc-1",
  type: "deposit",
  amount: 1000,
  currency: "USD",
  kind: "external",
};

const validDividend = {
  id: "div-1",
  at: "2026-01-10T00:00:00Z",
  accountId: "acc-1",
  symbolId: "QLD",
  amount: 5,
  currency: "USD",
};

const validPositionBasis = {
  at: "2026-01-06T00:00:00Z",
  accountId: "acc-1",
  symbolId: "QLD",
  shares: 10,
  averagePrice: 100,
  costBasis: 1000,
  estimatedExitFeeRate: 0.001,
};

const validSnapshots = [
  { at: "2026-01-01T00:00:00Z", totalKrw: 1_000_000, principalKrw: 900_000, fxRate: 1300 },
  { at: "2026-01-02T00:00:00Z", totalKrw: 1_010_000, principalKrw: 900_000, fxRate: 1305 },
];

describe("validateAll — 정상 데이터", () => {
  it("문제 없는 데이터셋은 에러가 없다", () => {
    const errors = validateAll({
      accounts,
      symbols,
      transactions: [validTransaction],
      cashflows: [validCashFlow],
      dividends: [validDividend],
      positionBasis: [validPositionBasis],
      snapshots: validSnapshots,
    });
    expect(errors).toEqual([]);
  });
});

describe("validateAccounts", () => {
  it("중복 id를 잡는다", () => {
    const errors = validateAccounts([accounts[0], { ...accounts[0] }]);
    expect(errors.some((e) => e.includes("중복된 id"))).toBe(true);
  });

  it("잘못된 currency를 잡는다", () => {
    const errors = validateAccounts([{ ...accounts[0], currency: "JPY" }]);
    expect(errors.some((e) => e.includes("currency"))).toBe(true);
  });
});

describe("validateSymbols", () => {
  it("잘못된 kind/market을 잡는다", () => {
    const errors = validateSymbols([{ ...symbols[0], kind: "bond", market: "JP" }]);
    expect(errors.some((e) => e.includes("kind"))).toBe(true);
    expect(errors.some((e) => e.includes("market"))).toBe(true);
  });
});

describe("validateTransactions", () => {
  it("존재하지 않는 accountId/symbolId를 잡는다", () => {
    const errors = validateTransactions(
      [{ ...validTransaction, accountId: "acc-ghost", symbolId: "GHOST" }],
      { accountIds, symbolIds },
    );
    expect(errors.some((e) => e.includes("accountId"))).toBe(true);
    expect(errors.some((e) => e.includes("symbolId"))).toBe(true);
  });

  it("음수 수량을 잡는다", () => {
    const errors = validateTransactions([{ ...validTransaction, shares: -5 }], { accountIds, symbolIds });
    expect(errors.some((e) => e.includes("shares"))).toBe(true);
  });

  it("NaN/Infinity 가격을 잡는다", () => {
    const errorsNaN = validateTransactions([{ ...validTransaction, price: Number.NaN }], { accountIds, symbolIds });
    const errorsInf = validateTransactions([{ ...validTransaction, price: Infinity }], { accountIds, symbolIds });
    expect(errorsNaN.some((e) => e.includes("price"))).toBe(true);
    expect(errorsInf.some((e) => e.includes("price"))).toBe(true);
  });

  it("비정상 날짜를 잡는다", () => {
    const errors = validateTransactions([{ ...validTransaction, at: "not-a-date" }], { accountIds, symbolIds });
    expect(errors.some((e) => e.includes("at 날짜"))).toBe(true);
  });

  it("액면분할에 splitRatio가 없거나 1이면 잡는다", () => {
    const missing = validateTransactions(
      [{ ...validTransaction, action: "split", price: 0, fee: 0 }],
      { accountIds, symbolIds },
    );
    const one = validateTransactions(
      [{ ...validTransaction, action: "split", price: 0, fee: 0, splitRatio: 1 }],
      { accountIds, symbolIds },
    );
    expect(missing.some((e) => e.includes("splitRatio"))).toBe(true);
    expect(one.some((e) => e.includes("splitRatio"))).toBe(true);
  });

  it("정상 액면분할 거래는 통과한다", () => {
    const errors = validateTransactions(
      [{ ...validTransaction, action: "split", price: 0, fee: 0, splitRatio: 2 }],
      { accountIds, symbolIds },
    );
    expect(errors).toEqual([]);
  });

  it("중복 id를 잡는다", () => {
    const errors = validateTransactions([validTransaction, { ...validTransaction }], { accountIds, symbolIds });
    expect(errors.some((e) => e.includes("중복된 id"))).toBe(true);
  });
});

describe("validateCashFlows", () => {
  it("잘못된 type과 음수 금액을 잡는다", () => {
    const errors = validateCashFlows(
      [{ ...validCashFlow, type: "invalid", amount: -10 }],
      { accountIds },
    );
    expect(errors.some((e) => e.includes("type"))).toBe(true);
    expect(errors.some((e) => e.includes("amount"))).toBe(true);
  });

  it("잘못된 kind를 잡는다", () => {
    const errors = validateCashFlows([{ ...validCashFlow, kind: "무엇" }], { accountIds });
    expect(errors.some((e) => e.includes("kind"))).toBe(true);
  });
});

describe("validateDividends", () => {
  it("존재하지 않는 symbolId를 잡는다", () => {
    const errors = validateDividends([{ ...validDividend, symbolId: "GHOST" }], { accountIds, symbolIds });
    expect(errors.some((e) => e.includes("symbolId"))).toBe(true);
  });
});

describe("validatePositionBasis", () => {
  it("계좌·종목 조합 중복을 잡는다", () => {
    const errors = validatePositionBasis([validPositionBasis, { ...validPositionBasis }], { accountIds, symbolIds });
    expect(errors.some((e) => e.includes("중복"))).toBe(true);
  });

  it("음수 shares/averagePrice/costBasis를 잡는다", () => {
    const errors = validatePositionBasis(
      [{ ...validPositionBasis, shares: -1, averagePrice: -1, costBasis: -1 }],
      { accountIds, symbolIds },
    );
    expect(errors.filter((e) => e.includes("shares") || e.includes("averagePrice") || e.includes("costBasis")).length).toBe(3);
  });

  it("estimatedExitFeeRate가 0~1을 벗어나면 잡는다", () => {
    const errors = validatePositionBasis(
      [{ ...validPositionBasis, estimatedExitFeeRate: 1.5 }],
      { accountIds, symbolIds },
    );
    expect(errors.some((e) => e.includes("estimatedExitFeeRate"))).toBe(true);
  });
});

describe("validateSnapshots", () => {
  it("날짜 중복을 잡는다", () => {
    const errors = validateSnapshots([validSnapshots[0], { ...validSnapshots[0] }]);
    expect(errors.some((e) => e.includes("중복"))).toBe(true);
  });

  it("정렬이 어긋나면 잡는다", () => {
    const errors = validateSnapshots([validSnapshots[1], validSnapshots[0]]);
    expect(errors.some((e) => e.includes("정렬"))).toBe(true);
  });

  it("fxRate가 0 이하면 잡는다", () => {
    const errors = validateSnapshots([{ ...validSnapshots[0], fxRate: 0 }]);
    expect(errors.some((e) => e.includes("fxRate"))).toBe(true);
  });
});

describe("validateBasisNotRegressing", () => {
  it("기준일이 원장 최신 시점보다 과거면 잡는다", () => {
    const errors = validateBasisNotRegressing(
      [{ ...validPositionBasis, at: "2020-01-01T00:00:00Z" }],
      { transactions: [validTransaction], cashflows: [validCashFlow] },
    );
    expect(errors.some((e) => e.includes("역행"))).toBe(true);
  });

  it("기준일이 원장 최신 시점 이후면 통과한다", () => {
    const errors = validateBasisNotRegressing([validPositionBasis], {
      transactions: [validTransaction],
      cashflows: [validCashFlow],
    });
    expect(errors).toEqual([]);
  });
});
