/**
 * 현금흐름 한 줄의 성격(`CashFlow.kind`)을 적요명으로 정한다.
 *
 * 원금은 **외부 입출금(`external`)만** 합산한다. 그래서 환전·이자·배당세 같은
 * 항목이 `external`로 새면 원금이 부풀고, 수익률이 통째로 틀어진다. 반대로
 * 실제 입금을 `income`으로 빼면 원금이 모자란다.
 *
 * 거래내역 가져오기(`import-transactions.mjs`)와 원장 정규화
 * (`ledger-normalize.mjs`)가 **같은 규칙을 써야 한다** — 예전에는 정규화 쪽에만
 * 규칙이 있어서, 새로 가져온 원장을 정규화에 한 번 더 태우면 성격이 바뀌었다.
 */

/**
 * @param {string} note 증권사 적요명 그대로. 예: `이체입금(지급결제)`, `환전정산입금`
 * @returns {"external" | "exchange" | "income" | "adjustment"}
 */
export function classifyCashFlowKind(note) {
  const text = String(note ?? "");
  // 사람이 손으로 맞춘 보정값. 원금에도 수익에도 넣지 않는다.
  if (/원장 재구성 보정/.test(text)) return "adjustment";
  if (/환전/.test(text)) return "exchange";
  // 이용료·대여수수료·세금 환급처럼 계좌가 스스로 만든 돈은 원금이 아니다.
  // 예탁금이용료(이자)입금·대여수수료입금(정기)·외국납부세환급(외화)입금처럼
  // 키움 2110 적요명이 그대로 들어온다.
  if (/쿠폰|배당|세액|세금|이자|이용료|대여수수료|납부세/.test(text)) return "income";
  return "external";
}
