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

export function dateLabel(iso: string) {
  return iso.slice(0, 10);
}

export function trendOf(value: number | null | undefined): "up" | "down" | "flat" {
  if (value === null || value === undefined || !Number.isFinite(value) || value === 0) return "flat";
  return value > 0 ? "up" : "down";
}
