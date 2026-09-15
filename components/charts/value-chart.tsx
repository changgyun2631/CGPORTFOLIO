"use client";

import { useMemo, useState } from "react";

import { analyzeSeries, downsample, filterSnapshots, ranges, type RangeKey } from "@/lib/domain/metrics";
import type { Snapshot } from "@/lib/domain/types";
import { money, moneySigned, percent, percentSigned, shortDateTime } from "@/lib/format";

/**
 * 총 평가금액 추이.
 *
 * 기간 탭은 클라이언트에서 처리한다. 스냅샷 전체를 한 번 받아두면
 * 탭을 눌러도 서버를 다시 다녀오지 않아 즉시 바뀐다.
 */

const WIDTH = 1000;
const HEIGHT = 300;
const PAD = { top: 16, right: 8, bottom: 26, left: 8 };

export function ValueChart({ snapshots, showFx = true }: { snapshots: Snapshot[]; showFx?: boolean }) {
  const [range, setRange] = useState<RangeKey>("3m");
  const [hover, setHover] = useState<number | null>(null);

  const { points, stats, fxPoints, series } = useMemo(() => {
    const filtered = filterSnapshots(snapshots, range);
    const stats = analyzeSeries(filtered);
    // 점이 많으면 솎아내되 최고점과 최저점은 반드시 남긴다.
    const series = downsample(filtered, 260, (s) => s.at === stats.peak?.at || s.at === stats.trough?.at);

    const values = series.map((s) => s.totalKrw);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = max - min || 1;
    const innerW = WIDTH - PAD.left - PAD.right;
    const innerH = HEIGHT - PAD.top - PAD.bottom;

    const points = series.map((s, i) => ({
      x: PAD.left + (series.length === 1 ? innerW / 2 : (i / (series.length - 1)) * innerW),
      y: PAD.top + innerH - ((s.totalKrw - min) / span) * innerH,
      snapshot: s,
    }));

    const fxValues = series.map((s) => s.fxRate);
    const fxMin = Math.min(...fxValues);
    const fxMax = Math.max(...fxValues);
    const fxSpan = fxMax - fxMin || 1;
    const fxPoints = series.map((s, i) => ({
      x: PAD.left + (series.length === 1 ? innerW / 2 : (i / (series.length - 1)) * innerW),
      // 환율선은 아래쪽 60% 영역에만 그려서 평가금액 선과 엉키지 않게 한다.
      y: PAD.top + innerH - ((s.fxRate - fxMin) / fxSpan) * innerH * 0.55,
    }));

    return { points, stats, fxPoints, series };
  }, [snapshots, range]);

  if (points.length === 0) {
    return <p className="py-10 text-center text-sm text-muted">표시할 스냅샷이 없습니다.</p>;
  }

  const rising = stats.changeAmount >= 0;
  const stroke = rising ? "var(--up)" : "var(--down)";
  const line = points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const area = `${line} ${points[points.length - 1].x.toFixed(1)},${HEIGHT - PAD.bottom} ${points[0].x.toFixed(1)},${HEIGHT - PAD.bottom}`;
  const fxLine = fxPoints.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");

  const active = hover === null ? points[points.length - 1] : points[Math.min(hover, points.length - 1)];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-1.5">
        {ranges.map((r) => (
          <button
            key={r.key}
            type="button"
            onClick={() => {
              setRange(r.key);
              setHover(null);
            }}
            aria-pressed={range === r.key}
            className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${
              range === r.key ? "bg-accent text-white" : "border border-line text-muted hover:border-line-strong hover:text-text"
            }`}
          >
            {r.label}
          </button>
        ))}
        <span className="ml-auto text-xs text-faint">{series.length}개 스냅샷</span>
      </div>

      <div className="relative">
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          className="h-[240px] w-full sm:h-[300px]"
          role="img"
          aria-label={`총 평가금액 추이, ${ranges.find((r) => r.key === range)?.label} 구간, ${percentSigned(stats.changePercent)}`}
          onMouseLeave={() => setHover(null)}
          onMouseMove={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            const ratio = (event.clientX - rect.left) / rect.width;
            const index = Math.round(ratio * (points.length - 1));
            setHover(Math.max(0, Math.min(index, points.length - 1)));
          }}
        >
          <defs>
            <linearGradient id="value-area" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={stroke} stopOpacity="0.26" />
              <stop offset="100%" stopColor={stroke} stopOpacity="0" />
            </linearGradient>
          </defs>

          {[0, 0.25, 0.5, 0.75, 1].map((t) => {
            const y = PAD.top + t * (HEIGHT - PAD.top - PAD.bottom);
            return <line key={t} x1={PAD.left} y1={y} x2={WIDTH - PAD.right} y2={y} stroke="var(--grid)" strokeWidth="1" />;
          })}

          <polygon points={area} fill="url(#value-area)" />
          {showFx ? (
            <polyline points={fxLine} fill="none" stroke="var(--accent)" strokeWidth="1.2" strokeDasharray="4 4" opacity="0.65" />
          ) : null}
          <polyline points={line} fill="none" stroke={stroke} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />

          <line x1={active.x} y1={PAD.top} x2={active.x} y2={HEIGHT - PAD.bottom} stroke="var(--border-strong)" strokeWidth="1" />
          <circle cx={active.x} cy={active.y} r="4" fill={stroke} stroke="var(--bg)" strokeWidth="2" />
        </svg>

        <div className="pointer-events-none absolute left-0 top-0 rounded-xl border border-line bg-bg-elevated/95 px-3 py-2 text-xs shadow-lg">
          <p className="text-faint">{shortDateTime(active.snapshot.at)}</p>
          <p className="tnum mt-0.5 text-sm font-bold">{money(active.snapshot.totalKrw)}</p>
          {showFx ? <p className="tnum mt-0.5 text-faint">환율 {active.snapshot.fxRate.toFixed(2)}</p> : null}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        <MiniStat label="구간 수익" value={moneySigned(stats.changeAmount)} sub={percentSigned(stats.changePercent)} tone={rising ? "up" : "down"} />
        <MiniStat
          label="최고점"
          value={money(stats.peak?.totalKrw)}
          sub={stats.peak ? shortDateTime(stats.peak.at) : undefined}
        />
        <MiniStat
          label="최저점"
          value={money(stats.trough?.totalKrw)}
          sub={stats.trough ? shortDateTime(stats.trough.at) : undefined}
        />
        <MiniStat
          label="MDD"
          value={percent(stats.maxDrawdown)}
          sub={
            stats.drawdownFrom && stats.drawdownTo
              ? `${shortDateTime(stats.drawdownFrom.at)} → ${shortDateTime(stats.drawdownTo.at)}`
              : undefined
          }
          tone={stats.maxDrawdown < 0 ? "down" : "default"}
        />
        <MiniStat label="현재/최고" value={percent(stats.vsPeakPercent)} sub={`최고 대비 ${moneySigned(stats.vsPeakAmount)}`} />
      </div>
    </div>
  );
}

function MiniStat({
  label,
  value,
  sub,
  tone = "default",
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "default" | "up" | "down";
}) {
  const color = tone === "up" ? "text-up" : tone === "down" ? "text-down" : "text-text";
  return (
    <div className="rounded-xl border border-line bg-bg-elevated px-3 py-2.5">
      <p className="text-[11px] text-muted">{label}</p>
      <p className={`tnum mt-1 text-[15px] font-bold leading-tight ${color}`}>{value}</p>
      {sub ? <p className="tnum mt-0.5 truncate text-[11px] text-faint">{sub}</p> : null}
    </div>
  );
}
