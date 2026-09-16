export type FreshnessLevel = "fresh" | "stale" | "missing";

export type FreshnessCheck = {
  /** "시세" | "잔고" | "원금" 처럼 화면에 붙일 짧은 이름 */
  label: string;
  asOf: string | null;
  level: FreshnessLevel;
  thresholdHours: number;
};

/**
 * 뉴욕 시각 기준으로 미국 정규장(평일 09:30~16:00 ET) 여부를 대략 판정한다.
 * 공휴일은 고려하지 않는다 — 완벽한 거래소 달력이 목적이 아니라 "지금 장이
 * 열려 있을 가능성이 높은가"로 신선도 임계시간을 나누는 용도다.
 */
export function isUsMarketHours(now: Date): boolean {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));

  if (byType.weekday === "Sat" || byType.weekday === "Sun") return false;

  // Intl은 자정을 "24"로 줄 때가 있다 — 24는 다음날 00분이라 장중이 아니다.
  const hour = Number(byType.hour) % 24;
  const minute = Number(byType.minute);
  const minutesSinceMidnight = hour * 60 + minute;
  return minutesSinceMidnight >= 9 * 60 + 30 && minutesSinceMidnight < 16 * 60;
}

function hoursSince(asOf: string, now: Date): number {
  return (now.getTime() - Date.parse(asOf)) / (1000 * 60 * 60);
}

function assess(label: string, asOf: string | null | undefined, thresholdHours: number, now: Date): FreshnessCheck {
  if (!asOf || Number.isNaN(Date.parse(asOf))) {
    return { label, asOf: null, level: "missing", thresholdHours };
  }
  const level: FreshnessLevel = hoursSince(asOf, now) > thresholdHours ? "stale" : "fresh";
  return { label, asOf, level, thresholdHours };
}

const BASIS_THRESHOLD_HOURS = 24 * 30; // 증권사 잔고는 수동 CSV 갱신이라 훨씬 느슨하게 잡는다.

/**
 * 시세·잔고·원금 세 기준값의 신선도를 판정한다.
 *
 * - 시세: 미국 정규장 중엔 8시간(6시간 주기 cron + 여유), 장 마감 중엔 48시간
 *   (주말을 넘겨도 마지막 종가가 여전히 유효하므로). 원금(스냅샷)도 같은 cron이
 *   같이 쓰므로 같은 기준을 쓴다.
 * - 잔고: 증권사 CSV를 사람이 수동으로 가져와야 갱신되므로 30일로 느슨하게 잡는다.
 */
/** 여러 항목의 asOf/at 중 가장 오래된 값을 찾는다 — 배치 중 일부만 갱신 실패해도 잡아내려는 목적. */
export function earliestAsOf(values: (string | null | undefined)[]): string | null {
  const valid = values.filter((v): v is string => Boolean(v) && !Number.isNaN(Date.parse(v as string)));
  if (valid.length === 0) return null;
  return valid.reduce((earliest, current) => (Date.parse(current) < Date.parse(earliest) ? current : earliest));
}

export function assessFreshness(
  input: { quoteAsOf: string | null; basisAsOf: string | null; principalAsOf: string | null },
  now: Date = new Date(),
): FreshnessCheck[] {
  const quoteThresholdHours = isUsMarketHours(now) ? 8 : 48;
  return [
    assess("시세", input.quoteAsOf, quoteThresholdHours, now),
    assess("잔고", input.basisAsOf, BASIS_THRESHOLD_HOURS, now),
    assess("원금", input.principalAsOf, quoteThresholdHours, now),
  ];
}
