import type { Snapshot } from "./types";

/**
 * 평가금액 시계열에서 뽑는 지표들.
 * 대시보드 추이 차트 아래 붙는 최고점·최저점·MDD·현재비율이 전부 여기서 나온다.
 */

export type RangeKey = "1d" | "7d" | "1m" | "3m" | "6m" | "ytd" | "1y" | "5y" | "all";

export const ranges: { key: RangeKey; label: string }[] = [
  { key: "1d", label: "1일" },
  { key: "7d", label: "7일" },
  { key: "1m", label: "1개월" },
  { key: "3m", label: "3개월" },
  { key: "6m", label: "6개월" },
  { key: "ytd", label: "연중" },
  { key: "1y", label: "1년" },
  { key: "5y", label: "5년" },
  { key: "all", label: "최대" },
];

/** 기준 시각에서 range 만큼 거슬러 올라간 시작 시각 */
export function rangeStart(range: RangeKey, reference: Date): Date | null {
  const d = new Date(reference);
  switch (range) {
    case "1d":
      d.setDate(d.getDate() - 1);
      return d;
    case "7d":
      d.setDate(d.getDate() - 7);
      return d;
    case "1m":
      d.setMonth(d.getMonth() - 1);
      return d;
    case "3m":
      d.setMonth(d.getMonth() - 3);
      return d;
    case "6m":
      d.setMonth(d.getMonth() - 6);
      return d;
    case "ytd":
      return new Date(`${d.getFullYear()}-01-01T00:00:00+09:00`);
    case "1y":
      d.setFullYear(d.getFullYear() - 1);
      return d;
    case "5y":
      d.setFullYear(d.getFullYear() - 5);
      return d;
    case "all":
      return null;
  }
}

export type FilteredSnapshots = {
  snapshots: Snapshot[];
  /**
   * 달력 구간에 실제 점이 2개 미만이라 마지막 N개 실제 관측값으로 대체했으면
   * true. 화면은 이걸로 "○일" 버튼이 실제로는 그 기간을 못 채웠다는 걸
   * 이용자에게 밝혀야 한다 — 계산(여기)과 표시(컴포넌트)가 같은 사실을 보게
   * 하려고 값 자체가 아니라 이 플래그를 공유한다.
   */
  usedFallback: boolean;
  /**
   * 점은 충분히 있지만(2개 이상) 기록이 구간 시작까지 닿지 못했으면 true.
   * 기록에 공백이 있으면 "1일"·"7일"·"1개월"이 전부 같은 며칠치를 보여주면서도
   * 아무 표시가 없었다 — 숫자는 맞지만 기간 이름이 사실과 달라 보이는 경우다.
   */
  shortOfRange: boolean;
};

/** 요청한 구간 대비 실제로 덮은 기간이 이 비율보다 짧으면 구간을 못 채운 걸로 본다. */
const RANGE_COVERAGE_MIN = 0.7;

/**
 * 장중 움직임을 그대로 보여줄 구간. 이보다 긴 구간은 하루 한 점으로 접는다.
 * 하루 안의 여러 점이 궁금한 건 짧은 구간을 볼 때뿐이다.
 */
const INTRADAY_RANGES = new Set<RangeKey>(["1d", "7d"]);

const newYork = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York",
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
});

function newYorkParts(ms: number) {
  const p = Object.fromEntries(newYork.formatToParts(new Date(ms)).map((part) => [part.type, part.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) };
}

/** 계좌수익률 CSV에서 온 점의 시각 표기(scripts/lib/import-account-history.mjs). 시각이 아니라 일자 라벨이다. */
export const CSV_LABEL = /^(\d{4}-\d{2}-\d{2})T15:30:00\+09:00$/;

/** 미국 장 하루가 시작하는 뉴욕 시각. 프리마켓(04:00 ET) 직전이라, 이보다 이른 점은 전날 장의 뒷부분으로 본다. */
const SESSION_START_SHIFT_MS = 3 * 3_600_000;

/**
 * 그 점이 속한 미국 거래 세션의 날짜(YYYY-MM-DD, 뉴욕 기준).
 * 세션은 뉴욕 03:00에 시작해 다음날 03:00에 끝난다 — 프리마켓·정규장·애프터마켓이 한 날이 되고,
 * KST 새벽에 찍히는 마감 직후 점이 전날 세션에 붙는다. CSV 점은 라벨 날짜가 곧 그날의 종가다.
 */
export function sessionDate(iso: string): string {
  const label = CSV_LABEL.exec(iso);
  if (label) return label[1];
  return newYorkParts(Date.parse(iso) - SESSION_START_SHIFT_MS).date;
}

/** 정규장 마감(뉴욕 16:00) 이후의 점인가. CSV 점은 종가 라벨이므로 항상 그렇다. */
function isAfterClose(iso: string): boolean {
  if (CSV_LABEL.test(iso)) return true;
  const { hour } = newYorkParts(Date.parse(iso));
  return hour >= 16 || hour < 3;
}

/**
 * 같은 미국 거래 세션(`sessionDate`)의 점을 **마감 기준 값** 하나로 접는다.
 * 정규장 마감 이후 첫 점을 쓰고, 마감 이후 점이 없는(아직 진행 중인) 세션은 마지막 점을 쓴다.
 * 마감 이후 점을 고르는 이유는 종목별 기여가 종가로 계산되기 때문이다 — 애프터마켓 가격이
 * 섞이면 일 손익과 기여 합이 어긋난다.
 *
 * x축이 날짜가 아니라 점 순서라, 하루에 찍히는 점 수가 구간마다 다르면 그만큼
 * 가로로 늘어난다. 지난 기록은 증권사 CSV에서 와서 하루 1개인데 예약 갱신은
 * 거래일마다 서너 개를 찍으므로, 그대로 두면 **최근 며칠만 서너 배로 벌어진다**.
 * 접어 두면 어느 구간이든 하루가 한 칸이다.
 *
 * 저장된 자료는 건드리지 않는다 — 보기만 고르는 것이라 짧은 구간에서는 장중
 * 움직임을 그대로 볼 수 있고, 나중에 다른 방식이 필요해도 되돌릴 수 있다.
 */
export function collapseDaily(snapshots: Snapshot[]): Snapshot[] {
  const bySession = new Map<string, { snapshot: Snapshot; afterClose: boolean }>();
  for (const snapshot of snapshots) {
    const key = sessionDate(snapshot.at);
    const afterClose = isAfterClose(snapshot.at);
    const kept = bySession.get(key);
    const t = Date.parse(snapshot.at);
    const keptT = kept ? Date.parse(kept.snapshot.at) : 0;
    const better =
      !kept ||
      (afterClose && !kept.afterClose) ||
      (afterClose === kept.afterClose && (afterClose ? t < keptT : t >= keptT));
    if (better) bySession.set(key, { snapshot, afterClose });
  }
  return [...bySession.values()].map((v) => v.snapshot).sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}

export function filterSnapshots(input: Snapshot[], range: RangeKey): FilteredSnapshots {
  if (input.length === 0) return { snapshots: [], usedFallback: false, shortOfRange: false };
  // 접는 것은 자르기 전에 한다 — 뒤의 "마지막 N개" 대체값도 하루 단위로 세야
  // 버튼 이름("30개 스냅샷")과 실제로 그린 점이 어긋나지 않는다.
  const snapshots = INTRADAY_RANGES.has(range) ? input : collapseDaily(input);
  const latest = new Date(snapshots[snapshots.length - 1].at);
  const start = rangeStart(range, latest);
  if (!start) return { snapshots, usedFallback: false, shortOfRange: false };
  const startIso = start.toISOString();
  const filtered = snapshots.filter((s) => new Date(s.at).toISOString() >= startIso);
  if (filtered.length >= 2) {
    const requested = latest.getTime() - start.getTime();
    const covered = latest.getTime() - new Date(filtered[0].at).getTime();
    return { snapshots: filtered, usedFallback: false, shortOfRange: covered < requested * RANGE_COVERAGE_MIN };
  }

  // 실제 일별 기록이 듬성듬성한 구간에서도 기간 버튼끼리 같은 두 점만
  // 반복하지 않도록, 가짜 날짜를 만들지 않고 마지막 N개 실제 관측값을 쓴다.
  const fallbackObservations: Partial<Record<RangeKey, number>> = {
    "1d": 2,
    "7d": 7,
    "1m": 30,
    "3m": 90,
    "6m": 180,
    ytd: 260,
    "1y": 365,
    "5y": 1_825,
  };
  const count = fallbackObservations[range] ?? 2;
  return { snapshots: snapshots.slice(-Math.min(count, snapshots.length)), usedFallback: true, shortOfRange: false };
}

export type SeriesStats = {
  count: number;
  first: Snapshot | null;
  last: Snapshot | null;
  peak: Snapshot | null;
  trough: Snapshot | null;
  /** 최대낙폭(%) — 음수 */
  maxDrawdown: number;
  /** 낙폭이 시작된 고점과 바닥 */
  drawdownFrom: Snapshot | null;
  drawdownTo: Snapshot | null;
  drawdownAmount: number;
  /** 현재가 최고점 대비 몇 %인지 */
  vsPeakPercent: number;
  vsPeakAmount: number;
  vsTroughPercent: number;
  vsTroughAmount: number;
  /** 구간 수익률(%) */
  changePercent: number;
  changeAmount: number;
};

export function analyzeSeries(snapshots: Snapshot[]): SeriesStats {
  const empty: SeriesStats = {
    count: 0,
    first: null,
    last: null,
    peak: null,
    trough: null,
    maxDrawdown: 0,
    drawdownFrom: null,
    drawdownTo: null,
    drawdownAmount: 0,
    vsPeakPercent: 0,
    vsPeakAmount: 0,
    vsTroughPercent: 0,
    vsTroughAmount: 0,
    changePercent: 0,
    changeAmount: 0,
  };
  if (snapshots.length === 0) return empty;

  const first = snapshots[0];
  const last = snapshots[snapshots.length - 1];

  let peak = snapshots[0];
  let trough = snapshots[0];
  for (const s of snapshots) {
    if (s.totalKrw > peak.totalKrw) peak = s;
    if (s.totalKrw < trough.totalKrw) trough = s;
  }

  // MDD는 "지금까지의 고점 대비 얼마나 빠졌나"를 훑으면서 가장 나쁜 값을 잡는다.
  let runningPeak = snapshots[0];
  let maxDrawdown = 0;
  let drawdownFrom: Snapshot | null = null;
  let drawdownTo: Snapshot | null = null;
  for (const s of snapshots) {
    if (s.totalKrw > runningPeak.totalKrw) runningPeak = s;
    const dd = runningPeak.totalKrw > 0 ? ((s.totalKrw - runningPeak.totalKrw) / runningPeak.totalKrw) * 100 : 0;
    if (dd < maxDrawdown) {
      maxDrawdown = dd;
      drawdownFrom = runningPeak;
      drawdownTo = s;
    }
  }

  return {
    count: snapshots.length,
    first,
    last,
    peak,
    trough,
    maxDrawdown,
    drawdownFrom,
    drawdownTo,
    drawdownAmount: drawdownFrom && drawdownTo ? drawdownTo.totalKrw - drawdownFrom.totalKrw : 0,
    vsPeakPercent: peak.totalKrw > 0 ? (last.totalKrw / peak.totalKrw) * 100 : 0,
    vsPeakAmount: last.totalKrw - peak.totalKrw,
    vsTroughPercent: trough.totalKrw > 0 ? (last.totalKrw / trough.totalKrw) * 100 : 0,
    vsTroughAmount: last.totalKrw - trough.totalKrw,
    changePercent: first.totalKrw > 0 ? ((last.totalKrw - first.totalKrw) / first.totalKrw) * 100 : 0,
    changeAmount: last.totalKrw - first.totalKrw,
  };
}

export type DrawdownResult = {
  /** 최대낙폭(%) — 음수 */
  maxDrawdown: number;
  fromAt: string | null;
  toAt: string | null;
};

/**
 * 입출금 효과를 뺀 최대낙폭.
 *
 * `analyzeSeries`의 낙폭은 평가금액 고점 대비로만 재서, 돈을 넣으면 오른 것처럼
 * 빼면 손실처럼 잡힌다. 성과를 보려면 외부 입출금을 제거한 수익지수로 재야 한다.
 *
 * **데이터 모델상의 가정**: 스냅샷 사이 `principalKrw`(순입금 누적)의 변화량을 그
 * 기간의 외부 현금흐름으로 본다. 이 프로젝트에서 `principalKrw`는 계좌수익률
 * CSV의 입금·출금 누적이므로 이 가정이 성립한다. **양쪽 스냅샷 모두
 * `principalKrw`가 유효한 숫자일 때만** 그 차이를 현금흐름으로 쓴다 — 한쪽만
 * 있으면(원금 필드 도입 전 구간과 이후 구간이 섞인 경우 등) 그 차이가 실제
 * 입출금이 아니라 "필드가 생긴 시점"을 반영할 뿐이라 현금흐름으로 오인하면 안
 * 된다. 그런 구간은 현금흐름을 0으로 보고(추정하지 않는다), 해당 구간 자체는
 * 평가액 기준 성장률로 넘긴다.
 *
 * 구간 수익률 = (기말 평가액 − 그 구간 순입금) ÷ 기초 평가액.
 * 입출금만 있고 가격이 그대로면 이 값이 1이라 지수가 안 움직이고, 낙폭도 안 깊어진다.
 */
export function cashflowAdjustedDrawdown(snapshots: Snapshot[]): DrawdownResult {
  const ordered = [...snapshots].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  if (ordered.length < 2) return { maxDrawdown: 0, fromAt: null, toAt: null };

  let index = 1;
  let peakIndex = 1;
  let peakAt = ordered[0].at;
  let maxDrawdown = 0;
  let fromAt: string | null = null;
  let toAt: string | null = null;

  for (let i = 1; i < ordered.length; i += 1) {
    const previous = ordered[i - 1];
    const current = ordered[i];
    // 기초 평가액이 0 이하면 수익률을 정의할 수 없다 — 지수를 끊지 않고 그대로 넘긴다.
    if (previous.totalKrw > 0) {
      // 양쪽 다 유효한 원금일 때만 차이를 현금흐름으로 본다. 한쪽만 있으면(원금
      // 필드가 중간에 생긴 경계 등) 현재 원금 전체를 그 구간 순입금으로 오인하게
      // 되므로, 그런 구간은 현금흐름 0으로 보고 평가액 성장률만 반영한다.
      const bothPrincipalsValid = Number.isFinite(previous.principalKrw) && Number.isFinite(current.principalKrw);
      const flow = bothPrincipalsValid ? current.principalKrw! - previous.principalKrw! : 0;
      const growth = (current.totalKrw - flow) / previous.totalKrw;
      // 음수 성장률(= 입출금 가정이 깨진 구간)은 지수를 뒤집으므로 반영하지 않는다.
      if (Number.isFinite(growth) && growth > 0) index *= growth;
    }

    if (index > peakIndex) {
      peakIndex = index;
      peakAt = current.at;
    }
    const drawdown = ((index - peakIndex) / peakIndex) * 100;
    if (drawdown < maxDrawdown) {
      maxDrawdown = drawdown;
      fromAt = peakAt;
      toAt = current.at;
    }
  }

  return { maxDrawdown, fromAt, toAt };
}

/**
 * 차트에 그릴 점이 너무 많으면 균등 간격으로 솎아낸다.
 * 최고점과 최저점은 어떤 경우에도 살려서 모양이 뭉개지지 않게 한다.
 */
export function downsample<T>(items: T[], limit: number, keep: (item: T) => boolean = () => false): T[] {
  if (items.length <= limit) return items;
  const step = (items.length - 1) / (limit - 1);
  const picked = new Set<number>();
  for (let i = 0; i < limit; i += 1) picked.add(Math.round(i * step));
  items.forEach((item, index) => {
    if (keep(item)) picked.add(index);
  });
  return [...picked].sort((a, b) => a - b).map((i) => items[i]);
}
