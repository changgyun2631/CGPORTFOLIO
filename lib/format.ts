/** 화면 표기용 포매터. 서버/클라이언트에서 같은 결과가 나오도록 항상 ko-KR 고정. */

const krw = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 0 });
const krwSigned = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 0, signDisplay: "always" });
const usd = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const usdSigned = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2, signDisplay: "always" });

export function money(value: number | null | undefined, currency: "KRW" | "USD" = "KRW") {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return currency === "USD" ? `$${usd.format(value)}` : `${krw.format(Math.round(value))}원`;
}

export function moneyBare(value: number | null | undefined, currency: "KRW" | "USD" = "KRW") {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return currency === "USD" ? `$${usd.format(value)}` : krw.format(Math.round(value));
}

export function moneySigned(value: number | null | undefined, currency: "KRW" | "USD" = "KRW") {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return currency === "USD" ? `${usdSigned.format(value)}` : `${krwSigned.format(Math.round(value))}원`;
}

export function percent(value: number | null | undefined, digits = 2) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return `${value.toFixed(digits)}%`;
}

export function percentSigned(value: number | null | undefined, digits = 2) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return `${value > 0 ? "+" : ""}${value.toFixed(digits)}%`;
}

export function shares(value: number) {
  return new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 6 }).format(value);
}

export function price(value: number | null | undefined, currency: "KRW" | "USD") {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return currency === "USD" ? `$${usd.format(value)}` : `₩${krw.format(Math.round(value))}`;
}

/** 2026-09-15T12:01:00+09:00 → "09/15 12:01" */
export function shortDateTime(iso: string) {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * 날짜만 있는 문자열("2026-01-15")은 그대로 쓰고, 시각까지 있는 ISO는 현지
 * 날짜로 바꾼다. 스냅샷은 CSV에서 온 건 `+09:00`, cron이 쓴 건 `Z`로 섞여 있어서
 * 앞 10자만 자르면 `Z` 쪽이 하루 어긋났다 — 같은 시점을 `shortDateTime`은 09/17,
 * 이 함수는 09/16으로 표시하던 문제.
 */
/**
 * 그날부터 오늘까지 며칠인가. 달력 날짜끼리 세므로, 어제 산 것은 시:분과 무관하게
 * 1일이다(시각까지 빼면 23시간 59분이 0일로 나온다).
 */
export function daysHeld(iso: string, now: Date = new Date()) {
  const startOfDay = (d: Date) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  const days = Math.floor((startOfDay(now) - startOfDay(new Date(iso))) / 86_400_000);
  return Number.isFinite(days) ? Math.max(days, 0) : null;
}

/** "412일" · 오늘 산 것은 "오늘". 앞의 숫자만 보고도 길이를 가늠하게 한다. */
export function daysHeldLabel(iso: string | null | undefined, now: Date = new Date()) {
  if (!iso || Number.isNaN(Date.parse(iso))) return "—";
  const days = daysHeld(iso, now);
  if (days === null) return "—";
  return days === 0 ? "오늘" : `${days.toLocaleString("ko-KR")}일`;
}

export function dateLabel(iso: string) {
  if (!/\d{2}:\d{2}/.test(iso)) return iso.slice(0, 10);
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** "2026-09-17 02:07" — 날짜와 분까지. 화면 상단 UPDATE 표기에 쓴다. */
export function dateTimeLabel(iso: string) {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function trendOf(value: number | null | undefined): "up" | "down" | "flat" {
  if (value === null || value === undefined || !Number.isFinite(value) || value === 0) return "flat";
  return value > 0 ? "up" : "down";
}
