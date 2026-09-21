export type CalendarResultSource =
  | { provider: "bls"; period: string }
  | { provider: "sec"; period: string; cik: string };

export type CalendarMetric = {
  id: string;
  label: string;
  unit: string;
  basis: string;
  previous: number | null;
  previousPeriod: string | null;
  yearAgo: number | null;
  yearAgoPeriod: string | null;
  actual: number | null;
  actualPeriod: string | null;
  firstObserved: number | null;
  firstObservedAt: string | null;
};

export type CalendarResult = {
  sourceKey: string;
  provider: "bls" | "sec";
  period: string;
  sourceUrl: string;
  status: "pending" | "available" | "partial" | "unavailable" | "error";
  checkedAt: string;
  lastSuccessAt: string | null;
  message: string;
  metrics: CalendarMetric[];
};

export type CalendarResults = {
  version: 1;
  checkedAt: string;
  results: Record<string, CalendarResult>;
};

export function calendarSourceKey(source: CalendarResultSource): string {
  return `${source.provider}:${source.provider === "sec" ? source.cik : "employment"}:${source.period}`;
}

export function seoulDate(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function formatCalendarValue(value: number | null, unit: string): string {
  if (value === null || !Number.isFinite(value)) return "—";
  if (/^[A-Z]{3}$/.test(unit) && Math.abs(value) >= 10000) {
    return `${new Intl.NumberFormat("ko-KR", { notation: "compact", maximumFractionDigits: 2 }).format(value)} ${unit}`;
  }
  const digits = unit === "천 명" ? 0 : unit === "%" || unit === "%p" ? 2 : unit.endsWith("/주") ? 2 : 0;
  return `${new Intl.NumberFormat("ko-KR", { maximumFractionDigits: digits }).format(value)} ${unit}`;
}
