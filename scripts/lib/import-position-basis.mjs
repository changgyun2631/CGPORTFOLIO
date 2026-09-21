import { parseCsvRows, parseNumber } from "./csv.mjs";

/**
 * 증권사 "보유종목" CSV를 파싱해 현재 잔고 기준값과, 그 안에 이미 있는
 * "평가손익" 열로 하는 교차검증 입력을 함께 만든다. 파일 IO를 하지 않는
 * 순수 함수라 CLI 스크립트와 웹 가져오기 화면(서버 액션)이 같이 쓴다.
 *
 * @param {string} decodedText - EUC-KR 디코딩이 끝난 CSV 전체 텍스트
 * @param {{ accountId: string, at: string }} options
 */
export function parsePositionBasisCsv(decodedText, { accountId, at }) {
  const rows = parseCsvRows(decodedText);
  const headerIndex = rows.findIndex((row) => row.includes("종목명") && row.includes("평가손익"));
  if (headerIndex < 0) throw new Error("보유종목 CSV 헤더를 찾지 못했습니다.");

  const headers = rows[headerIndex];
  const parsedRows = rows.slice(headerIndex + 1)
    .map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ""])))
    .filter((row) => row["코드"]);

  // 같은 종목이 여러 줄로 나뉘어 오는 경우가 있다 — 키움은 소수점 보유를 "온주"와
  // "소수점" 두 행으로 내보낸다(`소수점구분` 열). 그대로 두면 계좌×종목이 중복돼
  // 검증에서 막히므로, 수량·매입금액·수수료를 더해 한 줄로 합친다. 평단은 합친
  // 매입금액을 합친 수량으로 나눠 다시 구한다 — 행마다 평단이 다르기 때문에
  // 어느 한쪽 값을 그대로 쓰면 틀린다.
  const merged = new Map();
  for (const row of parsedRows) {
    const value = parseNumber(row["평가금액"]);
    const fee = parseNumber(row["수수료"]);
    const costBasis = parseNumber(row["매입금액"]);
    const shares = parseNumber(row["보유량"]);
    if (!(shares > 0 && costBasis >= 0)) continue;
    const symbolId = String(row["코드"]).replace(/^'/, "");

    const found = merged.get(symbolId) ?? { symbolId, shares: 0, costBasis: 0, value: 0, fee: 0, reportedGainLoss: 0 };
    found.shares += shares;
    found.costBasis += costBasis;
    found.value += value;
    found.fee += fee;
    found.reportedGainLoss += parseNumber(row["평가손익"]);
    merged.set(symbolId, found);
  }

  const basis = [];
  const crossCheckInput = [];
  for (const { symbolId, shares, costBasis, value, fee, reportedGainLoss } of merged.values()) {
    basis.push({
      at,
      accountId,
      symbolId,
      shares,
      averagePrice: costBasis / shares,
      costBasis,
      estimatedExitFeeRate: value > 0 ? fee / value : 0,
    });
    crossCheckInput.push({ symbolId, value, costBasis, fee, reportedGainLoss });
  }

  if (basis.length === 0) throw new Error("가져올 보유종목이 없습니다.");
  return { basis, crossCheckInput };
}
