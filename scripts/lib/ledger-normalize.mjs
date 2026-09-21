import { classifyCashFlowKind } from "./cashflow-kind.mjs";

/**
 * 거래원장의 주식 이체·액면분할과 현금흐름 성격을 명시한다. 순수 함수라
 * `normalize-ledger.mjs`(파일 IO)와 웹 가져오기 화면이 같이 쓴다.
 *
 * @param {{ transactions: object[], cashflows: object[], symbols: { id: string, currency: string }[] }} input
 */
export function normalizeLedger({ transactions, cashflows, symbols }) {
  const symbolById = new Map(symbols.map((symbol) => [symbol.id, symbol]));

  const nonTradeCashImpact = new Map();
  const addImpact = (currency, amount) => nonTradeCashImpact.set(currency, (nonTradeCashImpact.get(currency) ?? 0) + amount);
  for (const tx of transactions) {
    // `action`이 이미 붙어 있는 줄은 화면 계산이 이체·분할로 보고 현금에서 빼므로
    // 보정할 것이 없다. 이 보정은 action 없이 저장된 옛 원장을 위한 것이다
    // (거래내역 가져오기가 생기기 전에는 이체도 매매로 저장됐다).
    if (tx.action) continue;
    if (!/액면분할|이체입고|이체출고|대체입고|대체출고/.test(tx.note ?? "")) continue;
    // 리워드 이체입고는 아래의 상쇄용 현금흐름도 함께 제거하므로 이미 순효과가 0이다.
    if (/이체입고|대체입고/.test(tx.note ?? "")) continue;
    const symbol = symbolById.get(tx.symbolId);
    if (!symbol) continue;
    const gross = tx.shares * tx.price;
    const fee = tx.fee ?? 0;
    addImpact(symbol.currency, tx.side === "buy" ? -(gross + fee) : gross - fee);
  }

  const splitGroups = new Map();
  const normalizedTransactions = [];
  for (const tx of transactions) {
    const note = tx.note ?? "";
    // 가져오기가 이미 한 줄로 합쳐 놓은 분할은 다시 짝지으려 하면 안 된다
    // ("전후 거래가 완전하지 않습니다"로 터진다). 그대로 통과시킨다.
    if (tx.action === "split") {
      normalizedTransactions.push(tx);
      continue;
    }
    if (/액면분할/.test(note)) {
      const key = `${tx.accountId}::${tx.symbolId}::${tx.at.slice(0, 10)}`;
      const group = splitGroups.get(key) ?? [];
      group.push(tx);
      splitGroups.set(key, group);
    } else {
      normalizedTransactions.push({
        ...tx,
        // 가져오기가 정한 성격이 있으면 그것을 믿는다. 적요명으로 다시 추측하면
        // 증권사 표현이 조금만 달라도(대체입고/이체입고) 이체가 매매로 뒤집힌다.
        action: tx.action ?? (/이체입고|이체출고|대체입고|대체출고/.test(note) ? "transfer" : "trade"),
      });
    }
  }

  for (const [key, group] of splitGroups) {
    const before = group.find((tx) => tx.side === "sell");
    const after = group.find((tx) => tx.side === "buy");
    if (!before || !after || before.shares <= 0) throw new Error(`${key}: 액면분할 전후 거래가 완전하지 않습니다.`);
    normalizedTransactions.push({
      id: `split-${after.symbolId}-${after.at.slice(0, 10)}`,
      at: [before.at, after.at].sort()[0],
      accountId: after.accountId,
      symbolId: after.symbolId,
      side: "buy",
      action: "split",
      shares: after.shares,
      price: 0,
      fee: 0,
      splitRatio: after.shares / before.shares,
      note: "액면분할 — 현금 및 실현손익에 영향 없음",
    });
  }
  normalizedTransactions.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));

  const normalizedCashflows = cashflows
    .filter((cashflow) => !/이체입고 상쇄/.test(cashflow.note ?? ""))
    .map((cashflow) => ({ ...cashflow, kind: classifyCashFlowKind(cashflow.note) }));

  // 기존 화면에서 맞춘 예수금은 유지하면서, 주식 이체·분할의 잘못된 현금 효과만 보정 항목으로 옮긴다.
  for (const [currency, impact] of nonTradeCashImpact) {
    const correction = normalizedCashflows.find((cashflow) => cashflow.kind === "adjustment" && cashflow.currency === currency);
    if (!correction || Math.abs(impact) < 1e-9) continue;
    const oldSigned = correction.type === "deposit" ? correction.amount : -correction.amount;
    const nextSigned = oldSigned + impact;
    correction.type = nextSigned >= 0 ? "deposit" : "withdraw";
    correction.amount = Math.abs(nextSigned);
  }

  return { transactions: normalizedTransactions, cashflows: normalizedCashflows };
}
