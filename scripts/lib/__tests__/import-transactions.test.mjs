import { describe, expect, it } from "vitest";

import { parseTransactionsCsv } from "../import-transactions.mjs";

const HEADER = [
  "Version=1.0",
  "거래일자,거래종류,통화,거래수량,거래금액,정산금액,세금합,인지세,미수(원/주),변제합,매체구분",
  "종목코드,적요명,거래단가/환율,,예수금잔고,외화예수금잔고,,유가금잔,,연체합,처리시간",
  "거래소,종목명,,,거래금액(외),정산금액(외),수수료(외),미수(외),,변제합(외),외국납부세액",
].join("\n");

/** 한 거래가 세 줄인 키움 2110 형식을 그대로 만든다. */
function record({
  date = "2025-03-04",
  kind = "매매",
  currency = "USD",
  shares = 0,
  grossKrw = 0,
  settledKrw = 0,
  taxKrw = 0,
  symbolId = "",
  note = "매수",
  price = 0,
  time = "9:30:00",
  grossFx = 0,
  settledFx = 0,
  feeFx = 0,
}) {
  return [
    `${date},${kind},${currency},${shares},${grossKrw},${settledKrw},${taxKrw},0,0,0,영웅문S`,
    `${symbolId},${note},${price},,0,0,,0,,0,${time}`,
    `미국,이름,,,${grossFx},${settledFx},${feeFx},0,,0,0`,
  ].join("\n");
}

function csv(...records) {
  return [HEADER, ...records].join("\n");
}

const options = { accountId: "acc-1" };

describe("parseTransactionsCsv", () => {
  it("세 줄짜리 매매 한 건을 거래 하나로 읽는다", () => {
    const text = csv(record({ symbolId: "QLD", shares: 2, price: 50, grossFx: 100, settledFx: 100.1, feeFx: 0.1 }));
    const { transactions } = parseTransactionsCsv(text, options);

    expect(transactions).toEqual([
      {
        id: "acc-1-tx-0001",
        at: "2025-03-04T09:30:00+09:00",
        accountId: "acc-1",
        symbolId: "QLD",
        side: "buy",
        action: "trade",
        shares: 2,
        price: 50,
        fee: 0.1,
      },
    ]);
  });

  it("시가 한 자리로 오는 처리시간을 두 자리로 맞춘다", () => {
    const text = csv(record({ symbolId: "QLD", shares: 1, price: 10, grossFx: 10, time: "8:07:55" }));
    const { transactions } = parseTransactionsCsv(text, options);
    expect(transactions[0].at).toBe("2025-03-04T08:07:55+09:00");
  });

  it("대체입고·대체출고는 매매가 아니라 이체로 넣는다", () => {
    const text = csv(
      record({ kind: "입출고", note: "대체입고", symbolId: "SCHD", shares: 3, price: 20 }),
      record({ kind: "입출고", note: "대체출고", symbolId: "SCHD", shares: 1, price: 20 }),
    );
    const { transactions } = parseTransactionsCsv(text, options);

    expect(transactions.map((tx) => [tx.action, tx.side, tx.fee])).toEqual([
      ["transfer", "buy", 0],
      ["transfer", "sell", 0],
    ]);
  });

  it("액면분할 입고·출고 두 줄을 배수 하나짜리 분할 거래로 합친다", () => {
    const text = csv(
      record({ kind: "입출고", note: "액면분할병합출고", symbolId: "QLD", shares: 5, price: 100 }),
      record({ kind: "입출고", note: "액면분할병합입고", symbolId: "QLD", shares: 10, price: 50, time: "9:31:00" }),
    );
    const { transactions, warnings } = parseTransactionsCsv(text, options);

    expect(warnings).toEqual([]);
    expect(transactions).toHaveLength(1);
    expect(transactions[0]).toMatchObject({ action: "split", symbolId: "QLD", shares: 10, splitRatio: 2, price: 0 });
  });

  it("짝이 없는 액면분할은 버리지 않고 이체로 남긴 뒤 알린다", () => {
    const text = csv(record({ kind: "입출고", note: "액면분할병합입고", symbolId: "QLD", shares: 10, price: 50 }));
    const { transactions, warnings } = parseTransactionsCsv(text, options);

    expect(transactions[0].action).toBe("transfer");
    expect(warnings[0]).toContain("짝을 이루지 않아");
  });

  it("환전 한 줄은 원화와 외화 현금흐름 두 줄이 된다", () => {
    const text = csv(
      record({
        kind: "환전",
        note: "원화주문 외화매수",
        currency: "USD",
        price: 1400,
        grossKrw: 140000,
        settledKrw: 140000,
        settledFx: 100,
      }),
    );
    const { cashflows } = parseTransactionsCsv(text, options);

    expect(cashflows.map((flow) => [flow.type, flow.currency, flow.amount, flow.kind])).toEqual([
      ["withdraw", "KRW", 140000, "exchange"],
      ["deposit", "USD", 100, "exchange"],
    ]);
    expect(cashflows[0].note).toBe("환전(외화매수), 환율 1400.00");
  });

  it("외화매도는 방향이 반대다", () => {
    const text = csv(
      record({ kind: "환전", note: "외화매도", currency: "USD", price: 1400, settledKrw: 140000, settledFx: 100 }),
    );
    const { cashflows } = parseTransactionsCsv(text, options);
    expect(cashflows.map((flow) => [flow.type, flow.currency])).toEqual([
      ["deposit", "KRW"],
      ["withdraw", "USD"],
    ]);
  });

  it("배당금은 배당으로만 넣는다 — 예수금이 배당에서 이미 더해지므로 현금흐름으로 또 넣지 않는다", () => {
    const text = csv(
      record({ kind: "입출금", note: "배당금(외화)입금", currency: "USD", symbolId: "SCHD", grossFx: 12, settledFx: 10.2 }),
    );
    const { dividends, cashflows } = parseTransactionsCsv(text, options);

    expect(cashflows).toEqual([]);
    // 세후 실수령액(정산금액)을 쓴다. 원천징수 전 금액이 아니다.
    expect(dividends).toEqual([
      { id: "acc-1-dv-0001", at: "2025-03-04T09:30:00+09:00", accountId: "acc-1", symbolId: "SCHD", amount: 10.2, currency: "USD" },
    ]);
  });

  it("적요명에 출금이 들어가면 나간 돈으로 본다", () => {
    const text = csv(
      record({ kind: "입출금", note: "공모불입출금", currency: "KRW", grossKrw: 1000, settledKrw: 1000 }),
      record({ kind: "입출금", note: "이체입금(지급결제)", currency: "KRW", grossKrw: 2000, settledKrw: 2000 }),
    );
    const { cashflows } = parseTransactionsCsv(text, options);
    expect(cashflows.map((flow) => [flow.note, flow.type, flow.kind])).toEqual([
      ["공모불입출금", "withdraw", "external"],
      ["이체입금(지급결제)", "deposit", "external"],
    ]);
  });

  it("이자·이용료는 원금이 아니라 수익으로 분류한다", () => {
    const text = csv(
      record({ kind: "입출금", note: "예탁금이용료(이자)입금", currency: "KRW", grossKrw: 30, settledKrw: 30 }),
    );
    const { cashflows } = parseTransactionsCsv(text, options);
    expect(cashflows[0].kind).toBe("income");
  });

  it("모르는 거래종류는 조용히 버리지 않고 알린다", () => {
    const text = csv(record({ kind: "대출", note: "담보대출실행", currency: "KRW", settledKrw: 100 }));
    const { transactions, cashflows, unknown, warnings } = parseTransactionsCsv(text, options);

    expect(transactions).toEqual([]);
    expect(cashflows).toEqual([]);
    expect(unknown).toEqual(["대출"]);
    expect(warnings[0]).toContain("대출");
  });

  it("거래금액이 수량×단가와 맞지 않으면 검산에서 걸린다", () => {
    const text = csv(record({ symbolId: "QLD", shares: 2, price: 50, grossFx: 999 }));
    const { crossCheck } = parseTransactionsCsv(text, options);

    expect(crossCheck.ok).toBe(false);
    expect(crossCheck.mismatches[0].reason).toContain("수량×단가");
  });

  it("정상 파일은 검산을 통과한다", () => {
    const text = csv(
      record({ symbolId: "QLD", shares: 2, price: 50, grossFx: 100, settledFx: 100.1, feeFx: 0.1 }),
      record({ kind: "환전", note: "원화주문 외화매수", price: 1400, settledKrw: 140000, settledFx: 100 }),
    );
    expect(parseTransactionsCsv(text, options).crossCheck).toMatchObject({ ok: true, checked: 2 });
  });

  it("조회 기간을 첫 거래와 마지막 거래로 알려준다", () => {
    const text = csv(
      record({ date: "2025-03-04", symbolId: "QLD", shares: 1, price: 10, grossFx: 10 }),
      record({ date: "2025-01-02", symbolId: "QLD", shares: 1, price: 10, grossFx: 10 }),
    );
    const { coverage } = parseTransactionsCsv(text, options);
    expect([coverage.from.slice(0, 10), coverage.to.slice(0, 10)]).toEqual(["2025-01-02", "2025-03-04"]);
  });

  it("같은 시각이면 매수를 먼저 놓는다 — 처리시간이 그날 정산 배치 시각이라 하루치가 같은 값이다", () => {
    const text = csv(
      record({ symbolId: "QLD", shares: 3, price: 10, grossFx: 30, note: "매도" }),
      record({ symbolId: "QLD", shares: 5, price: 10, grossFx: 50, note: "매수" }),
    );
    const { transactions } = parseTransactionsCsv(text, options);
    // 파일 순서대로 두면 보유수량보다 많이 판 것처럼 접혀 원가가 잘린다.
    expect(transactions.map((tx) => tx.side)).toEqual(["buy", "sell"]);
  });

  it("계좌를 안 주면 거부한다 — 계좌를 짐작하면 엉뚱한 원장을 덮어쓴다", () => {
    expect(() => parseTransactionsCsv(csv(record({})), { accountId: "" })).toThrow("어느 계좌");
  });

  it("헤더가 없으면 에러를 던진다", () => {
    expect(() => parseTransactionsCsv("a,b,c\n1,2,3", options)).toThrow("헤더를 찾지 못했습니다");
  });

  it("한 거래가 세 줄이라는 전제가 깨지면 조용히 밀려 읽지 않고 멈춘다", () => {
    const text = `${csv(record({ symbolId: "QLD", shares: 1, price: 10, grossFx: 10 }))}\n군더더기,줄`;
    expect(() => parseTransactionsCsv(text, options)).toThrow("세 줄이라는 전제");
  });
});
