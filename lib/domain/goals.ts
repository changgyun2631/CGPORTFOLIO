/**
 * 총 평가금액 목표.
 *
 * 사용자가 "이 날짜까지 이 금액"을 몇 개 저장하면, 기준점(기록 첫날의 평가금액)과
 * 목표들을 날짜순으로 이어 **구간마다 매일 같은 비율로 자란다고 보고** 아무 날짜의
 * 목표를 구한다(복리 보간). 마지막 목표 뒤나 기준점 앞은 목표가 없다.
 */

export type AssetGoal = { date: string; amountKrw: number };

const DAY_MS = 86_400_000;
const dayIndex = (date: string) => Date.parse(`${date}T00:00:00Z`) / DAY_MS;

/** `anchor`는 곡선의 출발점(보통 기록 첫날). 목표가 없으면 빈 배열이다. */
export function goalCurve(anchor: AssetGoal | null, goals: AssetGoal[]): AssetGoal[] {
  const sorted = [...goals].sort((a, b) => a.date.localeCompare(b.date));
  if (sorted.length === 0) return [];
  return anchor && anchor.date < sorted[0].date && anchor.amountKrw > 0 ? [anchor, ...sorted] : sorted;
}

export function targetOn(curve: AssetGoal[], date: string): number | null {
  if (curve.length === 0 || date < curve[0].date || date > curve[curve.length - 1].date) return null;
  const i = curve.findIndex((point) => point.date >= date);
  if (curve[i].date === date || i === 0) return curve[i].amountKrw;
  const from = curve[i - 1];
  const to = curve[i];
  const t = (dayIndex(date) - dayIndex(from.date)) / (dayIndex(to.date) - dayIndex(from.date));
  return from.amountKrw * (to.amountKrw / from.amountKrw) ** t;
}

/** 저장 전 검사. 문제가 있으면 사람이 읽을 문장을, 없으면 null을 준다. */
export function goalError(goal: { date: string; amountKrw: number }): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(goal.date) || Number.isNaN(dayIndex(goal.date))) return "목표일을 날짜로 입력해 주세요.";
  if (!Number.isFinite(goal.amountKrw) || goal.amountKrw <= 0) return "목표금액은 0보다 커야 합니다.";
  if (goal.amountKrw > 1e14) return "목표금액이 너무 큽니다.";
  return null;
}
