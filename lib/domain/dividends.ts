import type { Holding } from "./portfolio";
import type { DividendPayment, FxRate, Symbol } from "./types";

/**
 * 배당 집계.
 *
 * 실제 수령 내역이 있으면 그것을 쓰고, 없는 종목은 배당률 추정치로
 * 연간 예상치를 채운다. 화면에서는 이 둘을 구분해서 보여줘야 한다.
 */

export type MonthlyDividend = {
  /** YYYY-MM */
  month: string;
  totalKrw: number;
  /** 종목별 분해 */
  bySymbol: { symbolId: string; name: string; amountKrw: number }[];
};

export type DividendSummary = {
  /** 연도별 합계 */
  byYear: { year: string; totalKrw: number; months: MonthlyDividend[] }[];
  /** 종목별 누적 */
  bySymbol: { symbolId: string; name: string; totalKrw: number; count: number; lastAt: string | null }[];
  /** 올해 수령액 */
  thisYearKrw: number;
  /** 가장 최근 1건 */
  latestKrw: number;
  latestAt: string | null;
  /** 연간 예상 배당 */
  forecastKrw: number;
  /** 예상치가 추정에 의존하는지 */
  forecastIsEstimated: boolean;
  totalKrw: number;
};

function toKrw(amount: number, currency: "KRW" | "USD", rate: number) {
  return currency === "USD" ? amount * rate : amount;
}

export function summarizeDividends(
  dividends: DividendPayment[],
  symbols: Symbol[],
  holdings: Holding[],
  fx: FxRate,
  now = new Date(),
): DividendSummary {
  const symbolById = new Map(symbols.map((s) => [s.id, s]));
  const nameOf = (id: string) => symbolById.get(id)?.name ?? id;

  const ordered = [...dividends].sort((a, b) => a.at.localeCompare(b.at));

  const monthMap = new Map<string, MonthlyDividend>();
  const symbolMap = new Map<string, { symbolId: string; name: string; totalKrw: number; count: number; lastAt: string | null }>();
  let totalKrw = 0;

  for (const payment of ordered) {
    const amountKrw = toKrw(payment.amount, payment.currency, fx.rate);
    totalKrw += amountKrw;

    const month = payment.at.slice(0, 7);
    const bucket = monthMap.get(month) ?? { month, totalKrw: 0, bySymbol: [] };
    bucket.totalKrw += amountKrw;
    const line = bucket.bySymbol.find((l) => l.symbolId === payment.symbolId);
    if (line) line.amountKrw += amountKrw;
    else bucket.bySymbol.push({ symbolId: payment.symbolId, name: nameOf(payment.symbolId), amountKrw });
    monthMap.set(month, bucket);

    const perSymbol = symbolMap.get(payment.symbolId) ?? {
      symbolId: payment.symbolId,
      name: nameOf(payment.symbolId),
      totalKrw: 0,
      count: 0,
      lastAt: null,
    };
    perSymbol.totalKrw += amountKrw;
    perSymbol.count += 1;
    perSymbol.lastAt = payment.at;
    symbolMap.set(payment.symbolId, perSymbol);
  }

  const yearMap = new Map<string, MonthlyDividend[]>();
  for (const bucket of monthMap.values()) {
    const year = bucket.month.slice(0, 4);
    const list = yearMap.get(year) ?? [];
    list.push(bucket);
    yearMap.set(year, list);
  }

  const byYear = [...yearMap.entries()]
    .map(([year, months]) => ({
      year,
      months: months.sort((a, b) => a.month.localeCompare(b.month)),
      totalKrw: months.reduce((sum, m) => sum + m.totalKrw, 0),
    }))
    .sort((a, b) => b.year.localeCompare(a.year));

  const currentYear = String(now.getFullYear());
  const thisYearKrw = byYear.find((y) => y.year === currentYear)?.totalKrw ?? 0;
  const latest = ordered[ordered.length - 1] ?? null;

  /**
   * 연간 예상 배당.
   * 최근 12개월 실지급액이 있으면 그것을 그대로 연간 예상으로 본다.
   * 지급 이력이 없는 보유 종목은 배당률 추정치로 더한다.
   */
  const cutoff = new Date(now);
  cutoff.setFullYear(cutoff.getFullYear() - 1);
  const cutoffIso = cutoff.toISOString().slice(0, 10);

  const paidLastYear = new Map<string, number>();
  for (const payment of ordered) {
    if (payment.at.slice(0, 10) < cutoffIso) continue;
    paidLastYear.set(payment.symbolId, (paidLastYear.get(payment.symbolId) ?? 0) + toKrw(payment.amount, payment.currency, fx.rate));
  }

  let forecastKrw = [...paidLastYear.values()].reduce((sum, v) => sum + v, 0);
  let forecastIsEstimated = false;

  for (const holding of holdings) {
    if (holding.kind === "cash") continue;
    if (paidLastYear.has(holding.symbolId)) continue;
    const yieldPercent = symbolById.get(holding.symbolId)?.dividendYield;
    if (!yieldPercent) continue;
    forecastKrw += (holding.valueKrw * yieldPercent) / 100;
    forecastIsEstimated = true;
  }

  return {
    byYear,
    bySymbol: [...symbolMap.values()].sort((a, b) => b.totalKrw - a.totalKrw),
    thisYearKrw,
    latestKrw: latest ? toKrw(latest.amount, latest.currency, fx.rate) : 0,
    latestAt: latest?.at ?? null,
    forecastKrw,
    forecastIsEstimated,
    totalKrw,
  };
}

/** 특정 연도의 12개월을 빠짐없이 채운 배열. 막대그래프가 빈 달에도 자리를 잡도록. */
export function monthsOfYear(summary: DividendSummary, year: string): MonthlyDividend[] {
  const found = summary.byYear.find((y) => y.year === year);
  return Array.from({ length: 12 }, (_, index) => {
    const month = `${year}-${String(index + 1).padStart(2, "0")}`;
    return found?.months.find((m) => m.month === month) ?? { month, totalKrw: 0, bySymbol: [] };
  });
}
