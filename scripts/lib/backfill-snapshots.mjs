/**
 * 마지막 스냅샷 이후의 빈 날짜를 **그날 종가**로 메운다.
 *
 * cron(`/api/cron/refresh`)은 "지금" 시점의 점만 찍는다 — 지나간 날짜는 영영
 * 안 채운다. 그래서 스냅샷을 다시 만들거나(계좌 정리 등) 며칠 서버가 안 떠
 * 있으면 차트가 그 날짜에서 멈춘 채로 남는다. 화면에는 아무 경고도 안 뜬다.
 *
 * 되살릴 수 있는 근거가 있을 때만 채운다:
 * - 보유수량은 `position-basis.json`(증권사 잔고)을 쓴다. 그래서 **마지막
 *   스냅샷 이후로 매매·입출금이 없었을 때만** 맞는다 — 부르는 쪽이 확인해야 한다.
 * - 가격은 `prices.json`의 그날 종가, 환율은 `fx.json`의 그날 값을 쓴다.
 *   둘 중 하나라도 없는 날은 **건너뛴다**(지어내지 않는다).
 * - 원금은 마지막 스냅샷의 값을 그대로 이어 쓴다. 외부 입출금이 없었다는 전제다.
 *
 * **금액은 절대값으로 계산하지 않고, 마지막 스냅샷에 등락률을 곱해 만든다.**
 * 기존 스냅샷은 증권사가 적어 준 예탁자산이고 우리 계산은 종가×수량인데, 실제로
 * 대보니 둘이 늘 2%쯤 어긋났다(환율 출처·평가 시점 차이로 보인다). 절대값을 그대로
 * 이어 붙이면 이어지는 자리에 그만큼 **가짜 단차**가 생긴다. 비율로 이으면 그
 * 차이가 상쇄돼 마지막 점에서 매끄럽게 이어진다.
 */

/** 그날 값이 없으면 그 이전 가장 가까운 값을 쓴다(휴장일 대비). */
function valueAt(series, date, maxLookbackDays = 7) {
  const byDate = series instanceof Map ? series : new Map(series.map((row) => [row.d, row]));
  const cursor = new Date(`${date}T00:00:00Z`);
  for (let i = 0; i <= maxLookbackDays; i += 1) {
    const key = cursor.toISOString().slice(0, 10);
    if (byDate.has(key)) return byDate.get(key);
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return null;
}

/**
 * @param {{
 *   snapshots: { at: string, totalKrw: number, principalKrw?: number, fxRate: number }[],
 *   holdings: { symbolId: string, shares: number, currency: "KRW" | "USD" }[],
 *   cash: { KRW: number, USD: number },
 *   prices: Record<string, { d: string, c: number }[]>,
 *   fxHistory: { d: string, rate: number }[],
 *   until?: string,
 * }} input
 * @returns {{ added: object[], skipped: { date: string, reason: string }[] }}
 */
export function backfillSnapshots({ snapshots, holdings, cash, prices, fxHistory, until }) {
  const last = [...snapshots].sort((a, b) => a.at.localeCompare(b.at)).at(-1);
  if (!last) throw new Error("기준이 될 스냅샷이 하나도 없습니다.");
  const lastDate = last.at.slice(0, 10);
  const have = new Set(snapshots.map((snapshot) => snapshot.at.slice(0, 10)));

  // 보유 종목 중 하나라도 종가가 있는 날짜만 후보로 본다. 시장이 열린 날의 대리 지표다.
  const candidates = new Set();
  for (const holding of holdings) {
    for (const row of prices[holding.symbolId] ?? []) {
      if (row.d > lastDate && (!until || row.d <= until)) candidates.add(row.d);
    }
  }

  const fxByDate = new Map(fxHistory.map((row) => [row.d, row]));
  const priceSeries = new Map(holdings.map((h) => [h.symbolId, new Map((prices[h.symbolId] ?? []).map((r) => [r.d, r]))]));

  /** 그날 종가·환율로 평가한 금액. 근거가 하나라도 없으면 이유를 돌려준다. */
  const valuate = (date) => {
    const fx = valueAt(fxByDate, date);
    if (!fx) return { error: "환율 없음" };

    let value = cash.KRW + cash.USD * fx.rate;
    for (const holding of holdings) {
      const price = valueAt(priceSeries.get(holding.symbolId), date);
      if (!price) return { error: `${holding.symbolId} 종가 없음` };
      value += holding.currency === "USD" ? holding.shares * price.c * fx.rate : holding.shares * price.c;
    }
    return { value, rate: fx.rate };
  };

  // 기준점: 마지막 스냅샷 날짜를 같은 방식으로 평가한 값. 이 값과의 비율만 쓴다.
  const base = valuate(lastDate);
  if (base.error) return { added: [], skipped: [{ date: lastDate, reason: `기준일 평가 불가 — ${base.error}` }] };
  if (!(base.value > 0)) return { added: [], skipped: [{ date: lastDate, reason: "기준일 평가금액이 0 이하" }] };

  const added = [];
  const skipped = [];
  for (const date of [...candidates].sort()) {
    if (have.has(date)) continue;

    const point = valuate(date);
    if (point.error) {
      skipped.push({ date, reason: point.error });
      continue;
    }

    added.push({
      // 계좌수익률 CSV가 만드는 일별 스냅샷과 같은 시각 표기를 쓴다.
      at: `${date}T15:30:00+09:00`,
      totalKrw: last.totalKrw * (point.value / base.value),
      principalKrw: last.principalKrw,
      fxRate: point.rate,
    });
  }

  return { added, skipped };
}
