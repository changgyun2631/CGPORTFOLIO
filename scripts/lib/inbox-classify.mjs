/**
 * 받은 CSV가 어떤 가져오기에 해당하는지 헤더만 보고 정한다.
 *
 * 파일 이름은 믿지 않는다 — 증권사 내보내기 이름은 화면 번호(`2110.csv`)거나
 * 무작위 문자열이라 내용과 무관하다. 실제로 화면 번호로 받은 파일 세 개가
 * 전부 예상과 다른 내용이었던 적이 있다(HANDOFF 참고).
 *
 * 각 importer가 실제로 요구하는 열과 같은 조건을 쓴다. 한쪽이 바뀌면 여기도
 * 같이 바꿀 것:
 *   - 계좌수익률: scripts/lib/import-account-history.mjs
 *   - 보유종목:   scripts/lib/import-position-basis.mjs
 *   - 거래내역:   scripts/lib/import-transactions.mjs
 */

import { parseCsvRows } from "./csv.mjs";

/** @typedef {"account-history" | "position-basis" | "transactions" | "unknown"} InboxKind */

/**
 * @param {string} decodedText 디코딩이 끝난 CSV 전체 텍스트
 * @returns {InboxKind}
 */
export function classifyInboxCsv(decodedText) {
  if (typeof decodedText !== "string" || decodedText.trim() === "") return "unknown";

  // 판별도 실제 importer와 같은 파서를 써야 한다. 예전엔 줄 단위로 잘라 쉼표로만
  // 나눴는데, 헤더 이름에 줄바꿈이 든 CSV(키움 2167)는 한 행이 두 줄로 쪼개져
  // 조건을 못 맞추고 "판별 못 함"으로 빠졌다(2026-09-21).
  const rows = parseCsvRows(decodedText).slice(0, 80);

  // 거래내역(2110)을 먼저 본다. 이 파일에도 "종목명" 열이 있어서 보유종목 조건과
  // 헷갈릴 수 있는데, 보유종목에만 있는 "평가손익"이 없다는 점으로 갈린다.
  const isTransactions = rows.some(
    (row) => row.includes("거래일자") && row.includes("거래종류") && row.includes("거래수량"),
  );
  if (isTransactions) return "transactions";

  const isAccountHistory = rows.some(
    (row) => row.includes("일자") && row.includes("예탁자산") && row.includes("입금") && row.includes("출금"),
  );
  if (isAccountHistory) return "account-history";

  const isPositionBasis = rows.some((row) => row.includes("종목명") && row.includes("평가손익"));
  if (isPositionBasis) return "position-basis";

  return "unknown";
}

/** 사람이 읽을 이름. 로그와 실패 사유에 쓴다. */
export const INBOX_KIND_LABEL = {
  "account-history": "계좌수익률",
  "position-basis": "보유종목(잔고)",
  transactions: "거래내역",
  unknown: "알 수 없음",
};
