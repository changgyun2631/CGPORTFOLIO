"use client";

import { useEffect, useMemo, useRef, useState } from "react";

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
const PAD = { top: 16, right: 44, bottom: 26, left: 44 };

export type ChartTrade = { at: string; side: "buy" | "sell" };

export function ValueChart({
  snapshots,
  showFx = true,
  /** 원금(순입금액). 주면 원금 대비 수익률 선을 같이 그린다. */
  principalKrw,
  /** 매매 시점. 주면 지점을 표시하는 토글 버튼이 생긴다. */
  trades = [],
}: {
  snapshots: Snapshot[];
  showFx?: boolean;
  principalKrw?: number;
  trades?: ChartTrade[];
}) {
  const [range, setRange] = useState<RangeKey>("3m");
  const [hover, setHover] = useState<number | null>(null);
  const [showTrades, setShowTrades] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === containerRef.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const { points, stats, fxPoints, returnPoints, series, min, max, returnMin, returnMax } = useMemo(() => {
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
    const xAt = (i: number) => PAD.left + (series.length === 1 ? innerW / 2 : (i / (series.length - 1)) * innerW);

    const points = series.map((s, i) => ({
      x: xAt(i),
      y: PAD.top + innerH - ((s.totalKrw - min) / span) * innerH,
      snapshot: s,
    }));

    const fxValues = series.map((s) => s.fxRate);
    const fxMin = Math.min(...fxValues);
    const fxMax = Math.max(...fxValues);
    const fxSpan = fxMax - fxMin || 1;
    const fxPoints = series.map((s, i) => ({
      x: xAt(i),
      // 환율선은 아래쪽 60% 영역에만 그려서 평가금액 선과 엉키지 않게 한다.
      y: PAD.top + innerH - ((s.fxRate - fxMin) / fxSpan) * innerH * 0.55,
    }));

    // 원금이 주어지면 "원금 대비 몇 % 인가"를 별도 선으로 그린다. 기간 동안 원금이
    // 바뀌었을 수 있다는 건 알지만(입출금), 스냅샷마다 그 시점 원금을 남겨두지
    // 않으므로 지금 원금을 구간 전체의 기준선으로 쓴다 — 근사치다.
    let returnPoints: { x: number; y: number }[] = [];
    let returnMin = 0;
    let returnMax = 0;
    if (principalKrw && principalKrw > 0) {
      const returns = series.map((s) => ((s.totalKrw - principalKrw) / principalKrw) * 100);
      returnMin = Math.min(...returns, 0);
      returnMax = Math.max(...returns, 0);
      const returnSpan = returnMax - returnMin || 1;
      returnPoints = returns.map((value, i) => ({
        x: xAt(i),
        y: PAD.top + innerH - ((value - returnMin) / returnSpan) * innerH,
      }));
    }

    return { points, stats, fxPoints, returnPoints, series, min, max, fxMin, fxMax, returnMin, returnMax };
  }, [snapshots, range, principalKrw]);

  if (points.length === 0) {
    return <p className="py-10 text-center text-sm text-muted">표시할 스냅샷이 없습니다.</p>;
  }

  const rising = stats.changeAmount >= 0;
  const stroke = rising ? "var(--up)" : "var(--down)";
  const line = points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const area = `${line} ${points[points.length - 1].x.toFixed(1)},${HEIGHT - PAD.bottom} ${points[0].x.toFixed(1)},${HEIGHT - PAD.bottom}`;
  const fxLine = fxPoints.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const returnLine = returnPoints.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const innerH = HEIGHT - PAD.top - PAD.bottom;
  const valueAtY = (t: number) => min + (1 - t) * (max - min);
  const axisUnit = max >= 100_000_000 ? 100_000_000 : 10_000;
  const axisSuffix = max >= 100_000_000 ? "억" : "만";

  const marker = (snapshot: Snapshot | null) => points.find((point) => point.snapshot.at === snapshot?.at);
  const peak = marker(stats.peak);
  const mddFrom = marker(stats.drawdownFrom);
  const mddTo = marker(stats.drawdownTo);

  // 매매 시점을 구간 안의 스냅샷에 매칭한다. 여러 거래가 같은 날에 몰려도 점 하나로
  // 합쳐 보여준다 — 겹친 표식이 서로를 가리는 걸 막기 위해서다. 렌더당 한 번뿐이고
  // 점이 최대 260개라 훅으로 감쌀 만큼 비싸지 않다.
  const tradeMarkers = (() => {
    if (!showTrades || trades.length === 0) return [];
    const start = points[0].snapshot.at;
    const end = points[points.length - 1].snapshot.at;
    const inRange = trades.filter((t) => t.at >= start && t.at <= end);
    const bySnapshot = new Map<string, "buy" | "sell" | "both">();
    for (const trade of inRange) {
      // 가장 가까운(같거나 이전) 스냅샷에 붙인다.
      let closest = points[0];
      for (const point of points) {
        if (point.snapshot.at > trade.at) break;
        closest = point;
      }
      const prev = bySnapshot.get(closest.snapshot.at);
      bySnapshot.set(closest.snapshot.at, prev && prev !== trade.side ? "both" : trade.side);
    }
    return [...bySnapshot.entries()]
      .map(([at, side]) => ({ point: points.find((p) => p.snapshot.at === at)!, side }))
      .filter((m) => m.point);
  })();

  const active = hover === null ? points[points.length - 1] : points[Math.min(hover, points.length - 1)];

  const toggleFullscreen = () => {
    if (!containerRef.current) return;
    if (document.fullscreenElement) document.exitFullscreen();
    else containerRef.current.requestFullscreen();
  };

  return (
    <div ref={containerRef} className={`space-y-4 ${fullscreen ? "flex h-screen flex-col justify-center bg-bg p-6" : ""}`}>
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
        <div className="ml-auto flex items-center gap-1.5">
          {trades.length > 0 ? (
            <button
              type="button"
              onClick={() => setShowTrades((v) => !v)}
              className="rounded-lg border border-line px-2.5 py-1 text-xs text-muted transition-colors hover:border-line-strong hover:text-text"
            >
              매수/매도 지점 {showTrades ? "숨기기" : "보이기"}
            </button>
          ) : null}
          <button
            type="button"
            onClick={toggleFullscreen}
            className="rounded-lg border border-line px-2.5 py-1 text-xs text-muted transition-colors hover:border-line-strong hover:text-text"
          >
            {fullscreen ? "전체화면 닫기" : "차트 전체화면"}
          </button>
          <span className="text-xs text-faint">{series.length}개 스냅샷</span>
        </div>
      </div>

      <div className="relative">
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          className={fullscreen ? "h-[70vh] w-full" : "h-[240px] w-full sm:h-[300px]"}
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
            const y = PAD.top + t * innerH;
            return (
              <g key={t}>
                <line x1={PAD.left} y1={y} x2={WIDTH - PAD.right} y2={y} stroke="var(--grid)" strokeWidth="1" />
                <text x={PAD.left - 8} y={y + 4} textAnchor="end" fill="var(--text-faint)" fontSize="10">
                  {(valueAtY(t) / axisUnit).toFixed(1)}
                  {axisSuffix}
                </text>
              </g>
            );
          })}

          <polygon points={area} fill="url(#value-area)" />
          {showFx ? (
            <polyline points={fxLine} fill="none" stroke="var(--accent)" strokeWidth="1.2" strokeDasharray="4 4" opacity="0.65" />
          ) : null}
          {returnPoints.length > 0 ? (
            <polyline points={returnLine} fill="none" stroke="var(--accent)" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" opacity="0.55" />
          ) : null}
          <polyline points={line} fill="none" stroke={stroke} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />

          {peak ? <ChartMarker point={peak} label="고점" tone="up" /> : null}
          {mddFrom && mddFrom !== peak ? <ChartMarker point={mddFrom} label="MDD 시작" tone="down" /> : null}
          {mddTo && mddTo !== peak && mddTo !== mddFrom ? <ChartMarker point={mddTo} label="MDD 저점" tone="down" /> : null}

          {tradeMarkers.map(({ point, side }) => (
            <TradeMarker key={point.snapshot.at} point={point} side={side} />
          ))}

          <line x1={active.x} y1={PAD.top} x2={active.x} y2={HEIGHT - PAD.bottom} stroke="var(--border-strong)" strokeWidth="1" />
          <circle cx={active.x} cy={active.y} r="4" fill={stroke} stroke="var(--bg)" strokeWidth="2" />

          {returnPoints.length > 0 ? (
            <>
              <text x={WIDTH - PAD.right + 6} y={PAD.top + 4} fill="var(--accent)" fontSize="10" opacity="0.85">
                {percentSigned(returnMax)}
              </text>
              <text x={WIDTH - PAD.right + 6} y={HEIGHT - PAD.bottom} fill="var(--accent)" fontSize="10" opacity="0.85">
                {percentSigned(returnMin)}
              </text>
            </>
          ) : null}
        </svg>

        <div className="pointer-events-none absolute left-0 top-0 rounded-xl border border-line bg-bg-elevated/95 px-3 py-2 text-xs shadow-lg">
          <p className="text-faint">{shortDateTime(active.snapshot.at)}</p>
          <p className="tnum mt-0.5 text-sm font-bold">{money(active.snapshot.totalKrw)}</p>
          {showFx ? <p className="tnum mt-0.5 text-faint">환율 {active.snapshot.fxRate.toFixed(2)}</p> : null}
        </div>

        {returnPoints.length > 0 || showFx ? (
          <div className="pointer-events-none absolute right-1 top-1 flex flex-col items-end gap-1 text-[10px] text-muted">
            {returnPoints.length > 0 ? <Legend color="var(--accent)" label="원금 대비 수익률" faded /> : null}
            {showFx ? <Legend color="var(--accent)" label="환율" dashed /> : null}
          </div>
        ) : null}
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        <MiniStat label="구간 수익" value={moneySigned(stats.changeAmount)} sub={percentSigned(stats.changePercent)} tone={rising ? "up" : "down"} />
        {principalKrw ? (
          <MiniStat
            label="원금 대비"
            value={percentSigned(((active.snapshot.totalKrw - principalKrw) / principalKrw) * 100)}
            sub={`원금 ${money(principalKrw)}`}
          />
        ) : (
          <MiniStat
            label="최고점"
            value={money(stats.peak?.totalKrw)}
            sub={stats.peak ? shortDateTime(stats.peak.at) : undefined}
          />
        )}
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

function ChartMarker({ point, label, tone }: { point: { x: number; y: number }; label: string; tone: "up" | "down" }) {
  const color = tone === "up" ? "var(--up)" : "var(--down)";
  const y = Math.max(point.y - 20, 12);
  return (
    <g>
      <circle cx={point.x} cy={point.y} r="4" fill={color} stroke="var(--bg)" strokeWidth="2" />
      <rect x={point.x - 24} y={y - 10} width="48" height="16" rx="8" fill="var(--bg-elevated)" stroke={color} strokeOpacity="0.6" />
      <text x={point.x} y={y + 1} textAnchor="middle" fill={color} fontSize="9" fontWeight="700">
        {label}
      </text>
    </g>
  );
}

/** 매수/매도 지점 표식. 같은 날 둘 다 있으면(both) 중립색 세모로 표시한다. */
function TradeMarker({ point, side }: { point: { x: number; y: number }; side: "buy" | "sell" | "both" }) {
  const color = side === "buy" ? "var(--up)" : side === "sell" ? "var(--down)" : "var(--text-faint)";
  const y = HEIGHT - PAD.bottom + 14;
  return <polygon points={`${point.x},${y - 5} ${point.x - 4.5},${y + 4} ${point.x + 4.5},${y + 4}`} fill={color} opacity="0.85" />;
}

function Legend({ color, label, dashed = false, faded = false }: { color: string; label: string; dashed?: boolean; faded?: boolean }) {
  return (
    <span className="flex items-center gap-1" style={{ opacity: faded ? 0.6 : 1 }}>
      <span className="h-0.5 w-3.5" style={{ background: dashed ? `repeating-linear-gradient(90deg, ${color} 0 3px, transparent 3px 6px)` : color }} />
      {label}
    </span>
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
