import { describe, expect, it } from "vitest";

import { normalizeLedger } from "../ledger-normalize.mjs";

const symbols = [{ id: "QLD", currency: "USD" }];

describe("normalizeLedger", () => {
  it("일반 거래는 action: trade로 표시한다", () => {
    const { transactions } = normalizeLedger({
      transactions: [{ id: "tx-1", at: "2026-01-01T00:00:00Z", accountId: "acc-1", symbolId: "QLD", side: "buy", shares: 1, price: 100 }],
      cashflows: [],
      symbols,
    });
    expect(transactions[0].action).toBe("trade");
  });

  it("이체입고/이체출고 메모가 있으면 action: transfer로 표시하고 예수금에 영향 없다", () => {
    const { transactions, cashflows } = normalizeLedger({
      transactions: [
        { id: "tx-1", at: "2026-01-01T00:00:00Z", accountId: "acc-1", symbolId: "QLD", side: "buy", shares: 1, price: 100, note: "이체입고" },
      ],
      cashflows: [{ id: "cf-1", at: "2026-01-01T00:00:00Z", accountId: "acc-1", type: "deposit", amount: 0, currency: "USD", note: "원장 재구성 보정" }],
      symbols,
    });
    expect(transactions[0].action).toBe("transfer");
    // "이체입고" 메모가 있으면 상쇄 로직 자체를 건너뛰므로 보정 현금흐름은 그대로(0)다.
    expect(cashflows.find((c) => c.kind === "adjustment")?.amount).toBe(0);
  });

  it("액면분할 전후 거래 쌍을 하나의 split 거래로 합친다", () => {
    const { transactions } = normalizeLedger({
      transactions: [
        { id: "tx-1", at: "2026-01-01T09:00:00Z", accountId: "acc-1", symbolId: "QLD", side: "sell", shares: 10, price: 0, note: "액면분할" },
        { id: "tx-2", at: "2026-01-01T09:00:01Z", accountId: "acc-1", symbolId: "QLD", side: "buy", shares: 20, price: 0, note: "액면분할" },
      ],
      cashflows: [],
      symbols,
    });
    expect(transactions).toHaveLength(1);
    expect(transactions[0]).toMatchObject({ action: "split", shares: 20, splitRatio: 2 });
  });

  it("액면분할 짝이 안 맞으면(매도만 있음) 에러를 던진다", () => {
    expect(() =>
      normalizeLedger({
        transactions: [{ id: "tx-1", at: "2026-01-01T00:00:00Z", accountId: "acc-1", symbolId: "QLD", side: "sell", shares: 10, price: 0, note: "액면분할" }],
        cashflows: [],
        symbols,
      }),
    ).toThrow("액면분할 전후 거래가 완전하지 않습니다");
  });

  it("현금흐름 메모로 kind를 분류한다", () => {
    const { cashflows } = normalizeLedger({
      transactions: [],
      cashflows: [
        { id: "cf-1", at: "2026-01-01T00:00:00Z", accountId: "acc-1", type: "deposit", amount: 100, currency: "KRW", note: "환전" },
        { id: "cf-2", at: "2026-01-02T00:00:00Z", accountId: "acc-1", type: "deposit", amount: 100, currency: "KRW", note: "배당 쿠폰" },
        { id: "cf-3", at: "2026-01-03T00:00:00Z", accountId: "acc-1", type: "deposit", amount: 100, currency: "KRW", note: "그냥 입금" },
      ],
      symbols,
    });
    expect(cashflows.map((c) => c.kind)).toEqual(["exchange", "income", "external"]);
  });

  it("이체를 매매에서 빼면서 사라지는 현금 효과를 보정 항목에 되돌려 놓는다", () => {
    const { cashflows } = normalizeLedger({
      transactions: [
        // 이체출고가 원장에는 side: "sell"로 기록돼 있어, 정규화 전에는 매도대금
        // +1000(=10주*100원)이 예수금에 들어온 것처럼 계산됐다. action: "transfer"로
        // 바뀌면 그 효과가 계산에서 빠지므로, 기존에 맞춰 둔 예수금 수준을 유지하려면
        // 보정 항목에 그만큼(+1000, 입금)을 되돌려 놔야 한다.
        { id: "tx-1", at: "2026-01-01T00:00:00Z", accountId: "acc-1", symbolId: "QLD", side: "sell", shares: 10, price: 100, fee: 0, note: "이체출고" },
      ],
      cashflows: [{ id: "cf-1", at: "2026-01-01T00:00:00Z", accountId: "acc-1", type: "deposit", amount: 0, currency: "USD", note: "원장 재구성 보정" }],
      symbols,
    });
    const correction = cashflows.find((c) => c.kind === "adjustment");
    expect(correction?.type).toBe("deposit");
    expect(correction?.amount).toBe(1000);
  });

  it("가져오기가 정해 준 action을 적요명으로 다시 추측해 뒤집지 않는다", () => {
    // 증권사 표현은 계좌마다 다르다(대체입고/이체입고). 적요명만 보고 다시
    // 판단하면 이체가 매매로 뒤집혀 실현손익과 예수금이 한꺼번에 틀어진다.
    const { transactions } = normalizeLedger({
      transactions: [
        { id: "tx-1", at: "2026-01-01T00:00:00Z", accountId: "acc-1", symbolId: "QLD", side: "buy", action: "transfer", shares: 1, price: 100, fee: 0, note: "대체입고" },
      ],
      cashflows: [],
      symbols,
    });
    expect(transactions[0].action).toBe("transfer");
  });

  it("이미 한 줄로 합쳐진 분할은 다시 짝지으려 하지 않는다", () => {
    const split = { id: "split-1", at: "2026-01-01T00:00:00Z", accountId: "acc-1", symbolId: "QLD", side: "buy", action: "split", shares: 20, price: 0, fee: 0, splitRatio: 2, note: "액면분할·병합 — 수량 2배" };
    const { transactions } = normalizeLedger({ transactions: [split], cashflows: [], symbols });
    expect(transactions).toEqual([split]);
  });

  it("이미 action이 붙은 이체는 보정 항목을 건드리지 않는다", () => {
    // 화면 계산이 이미 이체를 현금에서 빼고 있으므로 되돌릴 것이 없다.
    // 옛 원장(action 없음)만 보정 대상이다.
    const { cashflows } = normalizeLedger({
      transactions: [
        { id: "tx-1", at: "2026-01-01T00:00:00Z", accountId: "acc-1", symbolId: "QLD", side: "sell", action: "transfer", shares: 10, price: 100, fee: 0, note: "대체출고" },
      ],
      cashflows: [{ id: "cf-1", at: "2026-01-01T00:00:00Z", accountId: "acc-1", type: "deposit", amount: 0, currency: "USD", note: "원장 재구성 보정" }],
      symbols,
    });
    expect(cashflows.find((c) => c.kind === "adjustment")?.amount).toBe(0);
  });
});
