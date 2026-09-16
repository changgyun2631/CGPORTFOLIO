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

export function filterSnapshots(snapshots: Snapshot[], range: RangeKey): FilteredSnapshots {
  if (snapshots.length === 0) return { snapshots: [], usedFallback: false, shortOfRange: false };
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
 * CSV의 입금·출금 누적이므로 이 가정이 성립한다. `principalKrw`가 없는 스냅샷은
 * 그 구간의 현금흐름을 0으로 본다(추정하지 않는다).
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
      const flow = (current.principalKrw ?? previous.principalKrw ?? 0) - (previous.principalKrw ?? 0);
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
