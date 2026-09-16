import { buildPositions } from "./portfolio";
import type { Currency, Transaction } from "./types";

/**
 * 나스닥100 대비 실효 노출.
 *
 * 명목 비중만 보면 레버리지 상품을 얼마나 들고 있는지가 안 드러난다. QLD 50%는
 * 명목 50%지만 지수가 1% 움직이면 계좌는 1% 움직이므로, 실제로는 지수 100%를
 * 들고 있는 것과 같다. 그래서 비중에 배수를 곱해서 더한다.
 */

/**
 * 종목별 QQQ 배수. 사용자 결정(2026-09-17): QLD 2배, TQQQ 3배, 개별주는 0.
 *
 * 여기 없는 종목은 전부 0이다 — 개별주·현금·QQQ와 무관한 ETF가 여기 해당한다.
 * **새 레버리지 상품을 사면 이 표에 적어야 노출에 잡힌다.** 조용히 0으로 세지
 * 않으려고, 화면에서 배수가 잡힌 종목을 같이 보여준다.
 */
export const QQQ_LEVERAGE: Record<string, number> = {
  QQQ: 1,
  QLD: 2,
  TQQQ: 3,
};

export function qqqLeverageOf(symbolId: string): number {
  return QQQ_LEVERAGE[symbolId] ?? 0;
}

export type ExposureLine = {
  symbolId: string;
  leverage: number;
  valueKrw: number;
  /** 계좌 전체 대비 명목 비중(%) */
  weightPercent: number;
  /** 비중 × 배수(%) */
  exposurePercent: number;
};

export type ExposureSummary = {
  at: string;
  totalKrw: number;
  /** Σ(비중 × 배수) — 지수가 1% 움직일 때 계좌가 몇 % 움직이는지 */
  effectivePercent: number;
  /** 배수가 잡힌 종목들의 명목 비중 합 */
  nominalPercent: number;
  /** 배수가 0이 아닌 종목만, 노출이 큰 순서 */
  lines: ExposureLine[];
};

export function summarizeQqqExposure(
  at: string,
  totalKrw: number,
  entries: { symbolId: string; valueKrw: number }[],
): ExposureSummary {
  const lines: ExposureLine[] = [];
  for (const entry of entries) {
    const leverage = qqqLeverageOf(entry.symbolId);
    if (leverage === 0) continue;
    const weightPercent = totalKrw > 0 ? (entry.valueKrw / totalKrw) * 100 : 0;
    lines.push({
      symbolId: entry.symbolId,
      leverage,
      valueKrw: entry.valueKrw,
      weightPercent,
      exposurePercent: weightPercent * leverage,
    });
  }
  lines.sort((a, b) => b.exposurePercent - a.exposurePercent);

  return {
    at,
    totalKrw,
    effectivePercent: lines.reduce((sum, line) => sum + line.exposurePercent, 0),
    nominalPercent: lines.reduce((sum, line) => sum + line.weightPercent, 0),
    lines,
  };
}

/** 날짜 오름차순 시계열에서 그 날짜 이하의 마지막 값. 없으면 null. */
export function valueOnOrBefore<T extends { d: string }>(series: T[] | undefined, date: string): T | null {
  if (!series || series.length === 0) return null;
  let found: T | null = null;
  for (const point of series) {
    if (point.d > date) break;
    found = point;
  }
  return found;
}

export type ExposureAtInput = {
  /** 기준 시각(ISO). 이 시각까지의 거래만 반영한다. */
  at: string;
  transactions: Transaction[];
  /** `prices.json` — 종목별 일별 종가(과거→최신) */
  priceHistory: Record<string, { d: string; c: number }[]>;
  /** `fx.json` — 일별 USD/KRW(과거→최신) */
  fxHistory: { d: string; rate: number }[];
  /** 그 시점의 계좌 전체 평가금액(스냅샷의 실제 예탁자산) */
  totalKrw: number;
  currencyOf: (symbolId: string) => Currency;
};

/**
 * 과거 한 시점의 종목별 평가금액(원). 스냅샷에는 종목별 구성이 없어서, 그
 * 시점까지의 거래를 다시 돌려 보유 수량을 구하고 그날 종가·환율로 평가한다.
 *
 * 그날 종가를 모르는 종목은 **추정하지 않고 뺀다** — 그래서 이 값들의 합은
 * 스냅샷의 실제 예탁자산보다 작을 수 있다. 비중을 낼 때 분모는 항상 스냅샷의
 * 실제 금액을 쓸 것(합계로 나누면 없는 종목만큼 비중이 부풀려진다).
 */
export function positionValuesAsOf({
  at,
  transactions,
  priceHistory,
  fxHistory,
  currencyOf,
}: Omit<ExposureAtInput, "totalKrw">): { symbolId: string; shares: number; valueKrw: number }[] {
  const date = at.slice(0, 10);
  const upTo = transactions.filter((tx) => tx.at <= at);

  const sharesBySymbol = new Map<string, number>();
  for (const position of buildPositions(upTo)) {
    if (position.shares <= 0) continue;
    sharesBySymbol.set(position.symbolId, (sharesBySymbol.get(position.symbolId) ?? 0) + position.shares);
  }

  const rate = valueOnOrBefore(fxHistory, date)?.rate;

  const values: { symbolId: string; shares: number; valueKrw: number }[] = [];
  for (const [symbolId, shares] of sharesBySymbol) {
    const close = valueOnOrBefore(priceHistory[symbolId], date)?.c;
    if (close == null) continue;
    const inKrw = currencyOf(symbolId) === "USD" ? (rate ?? 0) : 1;
    values.push({ symbolId, shares, valueKrw: shares * close * inKrw });
  }
  return values;
}

/**
 * 과거 한 시점의 실효 노출. 분모는 추정하지 않고 스냅샷의 실제 예탁자산을 쓴다.
 */
export function qqqExposureAt(input: ExposureAtInput): ExposureSummary {
  return summarizeQqqExposure(input.at, input.totalKrw, positionValuesAsOf(input));
}
