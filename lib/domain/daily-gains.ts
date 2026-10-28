import { valueOnOrBefore } from "./exposure";
import { collapseDaily, CSV_LABEL, sessionDate } from "./metrics";
import type { Currency, Snapshot, Transaction } from "./types";

/**
 * 일별 평가손익과 종목별 기여.
 *
 * 일 손익은 차트 툴팁의 "전일 대비 이익"과 같은 값이다 — (평가금액 − 원금)의
 * 전일 대비 증감이라 입출금은 상쇄돼 빠진다. 스냅샷에는 종목별 값이 없으므로
 * 종목별 기여는 거래를 다시 돌려 보유 수량을 구하고 종가로 평가해 재구성한다.
 * 그래서 합이 일 손익과 정확히 맞지 않는다 — 차이는 `otherKrw`에 따로 둔다.
 */

export type DailyGainInput = {
  snapshots: Snapshot[];
  /** 스냅샷에 날짜별 원금이 없을 때 쓰는 현재 순입금 원금 */
  principalKrw?: number;
  transactions: Transaction[];
  /** `prices.json` — 종목별 일별 종가(과거→최신, 분할 소급 조정값) */
  priceHistory: Record<string, { d: string; c: number }[]>;
  /** `fx.json` — 일별 USD/KRW(과거→최신) */
  fxHistory: { d: string; rate: number }[];
  currencyOf: (symbolId: string) => Currency;
};

export type DailyGainRow = {
  /** 미국 거래일(뉴욕 기준). 마감 직후 점은 KST로 다음날 새벽이어도 그 거래일로 적는다. */
  date: string;
  totalKrw: number;
  /** 원금 대비 누적 이익(평가금액 − 원금). 원금을 모르면 null */
  gainKrw: number | null;
  /** 직전 거래일 대비 이익 증감(그 사이 주말 변동 포함). 첫날이나 원금을 모르는 날은 null */
  dayGainKrw: number | null;
  /** 전일 평가금액 대비 % */
  dayPercent: number | null;
  /** 종목별 기여(원), 절댓값이 큰 순. 반올림해 0인 종목은 뺀다. */
  contributions: { symbolId: string; krw: number }[];
  /** 일 손익 − 종목 기여 합. 배당·예수금 환율·증권사 예탁자산과의 계산 차이가 모인다. */
  otherKrw: number | null;
};

const kstDate = (iso: string) => new Date(iso).toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
const isWeekend = (date: string) => [0, 6].includes(new Date(`${date}T12:00:00Z`).getUTCDay());

const newYork = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York",
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
});

/**
 * 그 점이 가리키는 미국장 종가 날짜.
 * - CSV 점은 "그 일자의 종가" 라벨이다. 실제 시각(15:30 KST)으로 보면 전날 종가를 집어
 *   하루씩 어긋난다 — 이렇게 읽어야 종목 합이 일 손익과 훨씬 잘 맞는다.
 * - 그 밖의 점은 실제 시각 기준으로 이미 마감된 가장 최근 장이다(뉴욕 16시 전이면 전날).
 */
function lastCloseDate(iso: string) {
  const label = CSV_LABEL.exec(iso);
  if (label) return label[1];
  const p = Object.fromEntries(newYork.formatToParts(new Date(iso)).map((part) => [part.type, part.value]));
  const date = `${p.year}-${p.month}-${p.day}`;
  if (Number(p.hour) >= 16) return date;
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

export function buildDailyGains({
  snapshots,
  principalKrw,
  transactions,
  priceHistory,
  fxHistory,
  currencyOf,
}: DailyGainInput): DailyGainRow[] {
  const txs = transactions
    .map((tx) => ({ tx, t: Date.parse(tx.at) }))
    .filter(({ t }) => Number.isFinite(t))
    .sort((a, b) => a.t - b.t);
  const splits = txs
    .filter(({ tx }) => tx.action === "split" && Number.isFinite(tx.splitRatio) && (tx.splitRatio ?? 0) > 0)
    .map(({ tx, t }) => ({ symbolId: tx.symbolId, t, ratio: tx.splitRatio as number }));

  const held = new Map<string, number>();
  let cursor = 0;
  // 지난 점과 이번 점 사이에 체결된 일반 매매의 순매수액(원). 매매 금액이 손익으로 잡히지 않게 뺀다.
  let flow = new Map<string, number>();

  const advance = (t: number, fallbackFx: number) => {
    for (; cursor < txs.length && txs[cursor].t <= t; cursor++) {
      const { tx } = txs[cursor];
      const now = held.get(tx.symbolId) ?? 0;
      const action = tx.action ?? "trade";
      if (action === "split") {
        const ratio = tx.splitRatio ?? 1;
        if (Number.isFinite(ratio) && ratio > 0) held.set(tx.symbolId, now * ratio);
        continue;
      }
      held.set(tx.symbolId, tx.side === "buy" ? now + tx.shares : now - Math.min(tx.shares, now));
      // 이체는 현금이 오가지 않는다 — 평가금액만 늘고 원금은 그대로라 일 손익에도 이미 들어 있다.
      if (action !== "trade") continue;
      const fee = tx.fee ?? 0;
      const gross = tx.shares * tx.price;
      const rate = currencyOf(tx.symbolId) === "USD" ? (valueOnOrBefore(fxHistory, kstDate(tx.at))?.rate ?? fallbackFx) : 1;
      flow.set(tx.symbolId, (flow.get(tx.symbolId) ?? 0) + (tx.side === "buy" ? gross + fee : -(gross - fee)) * rate);
    }
    // 종가 이력은 분할을 소급 반영하므로 수량도 같은 기준(지금의 주식 수)으로 맞춘다.
    const adjusted = new Map<string, number>();
    for (const [symbolId, n] of held) {
      if (n <= 0) continue;
      const factor = splits.filter((s) => s.symbolId === symbolId && s.t > t).reduce((acc, s) => acc * s.ratio, 1);
      adjusted.set(symbolId, n * factor);
    }
    return adjusted;
  };

  /** 보유 수량을 그 시각 종가·환율로 평가한 원화 금액. 종가를 모르면 지어내지 않고 null. */
  const valueOf = (symbolId: string, shares: number, at: string, fxRate: number) => {
    if (shares === 0) return 0;
    const close = valueOnOrBefore(priceHistory[symbolId], lastCloseDate(at))?.c;
    if (close == null) return null;
    return shares * close * (currencyOf(symbolId) === "USD" ? fxRate : 1);
  };

  const rows: DailyGainRow[] = [];
  let prev: { snap: Snapshot; shares: Map<string, number>; gainKrw: number | null } | null = null;

  for (const snap of collapseDaily(snapshots)) {
    const shares = advance(Date.parse(snap.at), snap.fxRate);
    // 주말은 장이 쉬어 그날 값은 기록 출처 차이뿐이다 — 행을 따로 두지 않고 다음 거래일에
    // 합친다. prev와 쌓인 매매 흐름을 그대로 두면 다음 행이 금요일과 바로 비교된다.
    const date = sessionDate(snap.at);
    if (isWeekend(date)) continue;
    const tradeFlow = flow;
    flow = new Map();

    const basis = snap.principalKrw ?? principalKrw;
    const gainKrw = basis && basis > 0 ? snap.totalKrw - basis : null;
    const row: DailyGainRow = {
      date,
      totalKrw: snap.totalKrw,
      gainKrw,
      dayGainKrw: null,
      dayPercent: null,
      contributions: [],
      otherKrw: null,
    };

    if (prev) {
      if (gainKrw !== null && prev.gainKrw !== null) {
        row.dayGainKrw = gainKrw - prev.gainKrw;
        row.dayPercent = prev.snap.totalKrw > 0 ? (row.dayGainKrw / prev.snap.totalKrw) * 100 : null;
      }

      for (const symbolId of new Set([...prev.shares.keys(), ...shares.keys(), ...tradeFlow.keys()])) {
        const before = valueOf(symbolId, prev.shares.get(symbolId) ?? 0, prev.snap.at, prev.snap.fxRate);
        const after = valueOf(symbolId, shares.get(symbolId) ?? 0, snap.at, snap.fxRate);
        if (before === null || after === null) continue;
        const krw = Math.round(after - before - (tradeFlow.get(symbolId) ?? 0));
        if (krw !== 0) row.contributions.push({ symbolId, krw });
      }
      row.contributions.sort((a, b) => Math.abs(b.krw) - Math.abs(a.krw));
      if (row.dayGainKrw !== null) {
        row.otherKrw = row.dayGainKrw - row.contributions.reduce((sum, c) => sum + c.krw, 0);
      }
    }

    rows.push(row);
    prev = { snap, shares, gainKrw };
  }

  return rows;
}
