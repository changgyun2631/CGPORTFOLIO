import { describe, expect, it } from "vitest";

import { crossCheckPositionBasis } from "../cross-check.mjs";

function row(symbolId, value, costBasis, fee, reportedGainLoss) {
  return { symbolId, value, costBasis, fee, reportedGainLoss };
}

describe("crossCheckPositionBasis", () => {
  it("재계산 값이 CSV의 평가손익과 정확히 같으면 통과한다", () => {
    // 평가금액 1000 - 매입금액 800 - 수수료 2 = 198
    const result = crossCheckPositionBasis([row("QLD", 1000, 800, 2, 198)]);
    expect(result.ok).toBe(true);
    expect(result.exceeded).toEqual([]);
    expect(result.rows[0].diffKrw).toBe(0);
  });

  it("허용 오차(기본 5원) 이내 차이는 통과한다", () => {
    const result = crossCheckPositionBasis([row("QLD", 1000, 800, 2, 202)]); // 재계산 198, 차이 4
    expect(result.ok).toBe(true);
  });

  it("허용 오차를 넘는 차이는 실패하고 해당 종목을 exceeded에 담는다", () => {
    const result = crossCheckPositionBasis([row("QLD", 1000, 800, 2, 300)]); // 차이 102
    expect(result.ok).toBe(false);
    expect(result.exceeded).toEqual(["QLD"]);
  });

  it("여러 종목 중 일부만 초과해도 잡아낸다", () => {
    const result = crossCheckPositionBasis([
      row("QLD", 1000, 800, 2, 198), // 정상
      row("TQQQ", 500, 400, 1, 999), // 크게 어긋남
    ]);
    expect(result.ok).toBe(false);
    expect(result.exceeded).toEqual(["TQQQ"]);
  });

  it("사용자 지정 허용 오차를 쓸 수 있다", () => {
    const strict = crossCheckPositionBasis([row("QLD", 1000, 800, 2, 202)], { toleranceKrw: 1 }); // 차이 4 > 1
    expect(strict.ok).toBe(false);
    const loose = crossCheckPositionBasis([row("QLD", 1000, 800, 2, 300)], { toleranceKrw: 1000 }); // 차이 102 < 1000
    expect(loose.ok).toBe(true);
  });

  it("빈 배열은 통과한다", () => {
    expect(crossCheckPositionBasis([])).toMatchObject({ ok: true, exceeded: [], totalDiffKrw: 0 });
  });
});
