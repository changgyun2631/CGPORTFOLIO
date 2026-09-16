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

  const basis = [];
  const crossCheckInput = [];
  for (const row of parsedRows) {
    const value = parseNumber(row["평가금액"]);
    const fee = parseNumber(row["수수료"]);
    const costBasis = parseNumber(row["매입금액"]);
    const shares = parseNumber(row["보유량"]);
    if (!(shares > 0 && costBasis >= 0)) continue;
    const symbolId = String(row["코드"]).replace(/^'/, "");
    basis.push({
      at,
      accountId,
      symbolId,
      shares,
      averagePrice: parseNumber(row["매입가"]),
      costBasis,
      estimatedExitFeeRate: value > 0 ? fee / value : 0,
    });
    crossCheckInput.push({ symbolId, value, costBasis, fee, reportedGainLoss: parseNumber(row["평가손익"]) });
  }

  if (basis.length === 0) throw new Error("가져올 보유종목이 없습니다.");
  return { basis, crossCheckInput };
}
