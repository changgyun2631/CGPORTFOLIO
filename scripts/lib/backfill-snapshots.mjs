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
 * **금액은 화면의 "총 평가금액"과 같은 방식으로 계산한다** — 종가 × 보유수량 +
 * 예수금. 기존 스냅샷 중 계좌수익률 CSV에서 온 것은 증권사가 적어 준 예탁자산이라
 * 우리 계산과 2%쯤 차이가 나는데, 그쪽에 맞추려고 등락률만 이어 붙여 봤더니
 * **차트 끝점이 옆에 있는 총 평가금액과 2% 어긋나 보였다**(2026-09-21 사용자 지적).
 * cron이 앞으로 찍을 점도 전부 우리 계산이므로, 기준을 그쪽에 맞추는 게 맞다.
 * 그 결과 CSV 구간과 만나는 자리에 한 번 단차가 생기지만, 그건 **자료 출처가
 * 바뀌는 지점**이라 감추지 않는 편이 낫다.
 *
 * 시각은 **그날 미국장 종가가 찍힌 순간**(현지 16:00)을 쓴다. 계좌수익률 CSV가
 * 쓰는 15:30(+09:00)은 증권사가 원화 기준으로 하루를 닫는 시각이라, 미국 종목만
 * 담긴 이 계좌에는 맞지 않는다 — 그 시각엔 미국장이 열리지도 않았다.
 */

/** 그 시각의 뉴욕 시간대 오프셋(분). 서머타임은 직접 계산하지 않고 시간대 자료에 맡긴다. */
function newYorkOffsetMinutes(instant) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    })
      .formatToParts(instant)
      .map((part) => [part.type, part.value]),
  );
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour % 24, +parts.minute);
  return (asUtc - instant.getTime()) / 60000;
}

/** 그날 미국장 마감(현지 16:00)을 UTC ISO로. cron이 찍는 점과 같은 표기다. */
export function usMarketCloseIso(date) {
  const offset = newYorkOffsetMinutes(new Date(`${date}T12:00:00Z`));
  return new Date(Date.parse(`${date}T16:00:00Z`) - offset * 60000).toISOString();
}

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
      at: usMarketCloseIso(date),
      totalKrw: point.value,
      principalKrw: last.principalKrw,
      fxRate: point.rate,
    });
  }

  return { added, skipped };
}
