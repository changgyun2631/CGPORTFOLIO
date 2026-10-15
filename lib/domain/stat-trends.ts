/**
 * 대시보드 핵심 지표 카드의 추세선 — 평가손익과 수익 종목 수를 날짜별로 다시 그린다.
 *
 * 날짜별 원가 기록이 없어서 **지금 보유 수량·평균단가를 과거 종가에 대어 본 값**이다.
 * 그 사이 매매가 있었으면 실제 그날 숫자와 다르다 — 추세를 보는 용도로만 쓴다.
 */

type TrendHolding = {
  symbolId: string;
  currency: string;
  shares: number;
  averagePrice: number;
  price: number;
};

export function holdingTrends(
  holdings: TrendHolding[],
  history: Record<string, { d: string; c: number }[]>,
  fxRate: number,
  days: number,
): { gain: number[]; winners: number[] } {
  const dates = [...new Set(holdings.flatMap((h) => (history[h.symbolId] ?? []).slice(-days).map((p) => p.d)))]
    .sort()
    .slice(-days);
  if (dates.length < 2) return { gain: [], winners: [] };

  const gain = new Array<number>(dates.length).fill(0);
  const winners = new Array<number>(dates.length).fill(0);
  for (const h of holdings) {
    const series = history[h.symbolId] ?? [];
    const fx = h.currency === "USD" ? fxRate : 1;
    // 날짜마다 그날 이전의 마지막 종가를 쓴다 — 국내·미국 휴장일이 달라도 칸이 비지 않는다.
    let i = 0;
    let close = series.length > 0 && series[0].d <= dates[0] ? series[0].c : h.price;
    dates.forEach((date, k) => {
      while (i < series.length && series[i].d <= date) close = series[i++].c;
      const diff = close - h.averagePrice;
      gain[k] += diff * h.shares * fx;
      if (diff > 0) winners[k] += 1;
    });
  }
  return { gain, winners };
}
