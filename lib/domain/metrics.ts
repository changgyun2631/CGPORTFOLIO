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

export function filterSnapshots(snapshots: Snapshot[], range: RangeKey): Snapshot[] {
  if (snapshots.length === 0) return [];
  const latest = new Date(snapshots[snapshots.length - 1].at);
  const start = rangeStart(range, latest);
  if (!start) return snapshots;
  const startIso = start.toISOString();
  const filtered = snapshots.filter((s) => new Date(s.at).toISOString() >= startIso);
  if (filtered.length >= 2) return filtered;

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
  return snapshots.slice(-Math.min(count, snapshots.length));
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
