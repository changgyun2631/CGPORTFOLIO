/**
 * 증권사 보유종목 CSV는 "평가손익" 열을 이미 계산해서 준다. 우리는 같은 CSV의
 * 다른 열(평가금액·매입금액·수수료)로 그 값을 독립적으로 재계산해서 맞춰본다.
 *
 * 시세 API가 아니라 같은 CSV 안의 값끼리만 비교하므로 시장이 움직여도 흔들리지
 * 않는 결정적 검사다 — 열이 밀렸거나 인코딩이 깨졌거나 단위를 잘못 읽는 등의
 * 파싱 오류를 화면에서 숫자가 이상하다고 느끼기 전에 잡는 게 목적이다.
 */

/**
 * @param {{ symbolId: string, value: number, costBasis: number, fee: number, reportedGainLoss: number }[]} rows
 * @param {{ toleranceKrw?: number }} [options]
 */
export function crossCheckPositionBasis(rows, { toleranceKrw = 5 } = {}) {
  const results = rows.map((row) => {
    const recomputedGainLoss = row.value - row.costBasis - row.fee;
    const diffKrw = Math.abs(recomputedGainLoss - row.reportedGainLoss);
    return {
      symbolId: row.symbolId,
      recomputedGainLoss,
      reportedGainLoss: row.reportedGainLoss,
      diffKrw,
      withinTolerance: diffKrw <= toleranceKrw,
    };
  });

  const totalDiffKrw = results.reduce((sum, r) => sum + r.diffKrw, 0);
  const exceeded = results.filter((r) => !r.withinTolerance).map((r) => r.symbolId);

  return { rows: results, totalDiffKrw, toleranceKrw, exceeded, ok: exceeded.length === 0 };
}
