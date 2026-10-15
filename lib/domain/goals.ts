/**
 * 총 평가금액 목표. 날짜 없이 금액 하나만 두고, 지금 평가금액과 계속 비교한다.
 */

export type AssetGoal = { amountKrw: number };

/** 저장 전 검사. 문제가 있으면 사람이 읽을 문장을, 없으면 null을 준다. */
export function goalError(amountKrw: number): string | null {
  if (!Number.isFinite(amountKrw) || amountKrw <= 0) return "목표금액은 0보다 커야 합니다.";
  if (amountKrw > 1e14) return "목표금액이 너무 큽니다.";
  return null;
}

/** 목표까지 남은 금액(음수면 초과)과 달성률(%). */
export function goalProgress(currentKrw: number, goal: AssetGoal) {
  return { remainingKrw: goal.amountKrw - currentKrw, percent: (currentKrw / goal.amountKrw) * 100 };
}
