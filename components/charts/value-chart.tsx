"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { analyzeSeries, downsample, filterSnapshots, ranges, type RangeKey } from "@/lib/domain/metrics";
import { groupTradeMarkers, type ChartTrade } from "@/lib/domain/trade-markers";
import type { Snapshot } from "@/lib/domain/types";
import { dateLabel, money, moneySigned, percent, percentSigned, shortDateTime } from "@/lib/format";

/**
 * 총 평가금액 추이.
 *
 * 기간 탭은 클라이언트에서 처리한다. 스냅샷 전체를 한 번 받아두면
 * 탭을 눌러도 서버를 다시 다녀오지 않아 즉시 바뀐다.
 */

const WIDTH = 1000;
const HEIGHT = 300;
const PAD = { top: 16, right: 44, bottom: 26, left: 44 };

export type { ChartTrade };

export function ValueChart({
  snapshots,
  showFx = true,
  /** 원금(순입금액). 주면 원금 대비 수익률 선을 같이 그린다. */
  principalKrw,
  trades = [],
}: {
  snapshots: Snapshot[];
  showFx?: boolean;
  principalKrw?: number;
  trades?: ChartTrade[];
}) {
  const [range, setRange] = useState<RangeKey>("1y");
  const [showTrades, setShowTrades] = useState(true);
  const [hover, setHover] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === containerRef.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const { points, stats, fxPoints, returnPoints, principalPoints, series, min, max, returnMin, returnMax, usedFallback, shortOfRange } =
    useMemo(() => {
    const { snapshots: filtered, usedFallback, shortOfRange } = filterSnapshots(snapshots, range);
    const stats = analyzeSeries(filtered);
    // 점이 많으면 솎아내되 최고점과 최저점은 반드시 남긴다.
    const series = downsample(filtered, 260, (s) => s.at === stats.peak?.at || s.at === stats.trough?.at);

    const values = series.map((s) => s.totalKrw);
    // 원금(순입금 누적)도 같은 축에 선으로 그리므로, 원금이 평가금액 범위를 벗어나면
    // (예: 하락장에서 평가금액이 원금 아래로 내려가면) 축 자체를 넓혀서 잘리지 않게 한다.
    const principalValues = series.map((s) => s.principalKrw ?? principalKrw).filter((v): v is number => v != null && v > 0);
    const min = Math.min(...values, ...principalValues);
    const max = Math.max(...values, ...principalValues);
    const span = max - min || 1;
    const innerW = WIDTH - PAD.left - PAD.right;
    const innerH = HEIGHT - PAD.top - PAD.bottom;
    const xAt = (i: number) => PAD.left + (series.length === 1 ? innerW / 2 : (i / (series.length - 1)) * innerW);
    const yAt = (value: number) => PAD.top + innerH - ((value - min) / span) * innerH;

    const points = series.map((s, i) => ({
      x: xAt(i),
      y: yAt(s.totalKrw),
      snapshot: s,
    }));

    // 원금은 날짜별로 기록이 없으면(최근 자동 스냅샷 등) 현재 순입금 원금을 대체값으로 쓴다 —
    // "원금 대비 수익률" 선과 같은 기준이다.
    const principalPoints = series
      .map((s, i) => {
        const basis = s.principalKrw ?? principalKrw;
        return basis && basis > 0 ? { x: xAt(i), y: yAt(basis) } : null;
      })
      .filter((point): point is { x: number; y: number } => point !== null);

    const fxValues = series.map((s) => s.fxRate);
    const fxMin = Math.min(...fxValues);
    const fxMax = Math.max(...fxValues);
    const fxSpan = fxMax - fxMin || 1;
    const fxPoints = series.map((s, i) => ({
      x: xAt(i),
      // 환율선은 아래쪽 60% 영역에만 그려서 평가금액 선과 엉키지 않게 한다.
      y: PAD.top + innerH - ((s.fxRate - fxMin) / fxSpan) * innerH * 0.55,
    }));

    // 계좌수익률 원본에 기록된 날짜별 원금을 우선 사용한다. 최근 자동 스냅샷처럼
    // 날짜별 원금이 없는 점만 현재 순입금 원금을 안전한 대체값으로 쓴다.
    let returnPoints: { x: number; y: number }[] = [];
    let returnMin = 0;
    let returnMax = 0;
    const returns = series.map((s, i) => {
      const basis = s.principalKrw ?? principalKrw;
      return basis && basis > 0 ? { x: xAt(i), value: ((s.totalKrw - basis) / basis) * 100 } : null;
    }).filter((point): point is { x: number; value: number } => point !== null);
    if (returns.length > 1) {
      const values = returns.map((point) => point.value);
      returnMin = Math.min(...values, 0);
      returnMax = Math.max(...values, 0);
      const returnSpan = returnMax - returnMin || 1;
      returnPoints = returns.map((point) => ({
        x: point.x,
        y: PAD.top + innerH - ((point.value - returnMin) / returnSpan) * innerH,
      }));
    }

    return { points, stats, fxPoints, returnPoints, principalPoints, series, min, max, fxMin, fxMax, returnMin, returnMax, usedFallback, shortOfRange };
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
  const principalLine = principalPoints.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const innerH = HEIGHT - PAD.top - PAD.bottom;
  const valueAtY = (t: number) => min + (1 - t) * (max - min);
  const axisUnit = max >= 100_000_000 ? 100_000_000 : 10_000;
  const axisSuffix = max >= 100_000_000 ? "억" : "만";

  const marker = (snapshot: Snapshot | null) => points.find((point) => point.snapshot.at === snapshot?.at);
  const peak = marker(stats.peak);
  const mddFrom = marker(stats.drawdownFrom);
  const mddTo = marker(stats.drawdownTo);

  const active = hover === null ? points[points.length - 1] : points[Math.min(hover, points.length - 1)];

  const tradeMarkers = !showTrades
    ? []
    : groupTradeMarkers(
        points.map((p) => p.snapshot.at),
        trades,
      ).map((group) => ({
        point: points[group.snapshotIndex],
        buy: group.buy,
        sell: group.sell,
        symbols: group.symbols,
        side: group.side,
      }));

  // 마우스가 매매 타점과 같은 스냅샷에 가장 가까우면(= active 포인트와 일치하면)
  // 그 거래 내역을 호버 툴팁에도 같이 보여준다 — 세로 점선만으로는 어떤 종목인지
  // 알 수 없다는 피드백을 반영했다.
  const activeTradeMarker = tradeMarkers.find((marker) => marker.point.snapshot.at === active.snapshot.at) ?? null;

  const toggleFullscreen = () => {
    if (!containerRef.current) return;
    if (document.fullscreenElement) document.exitFullscreen();
    else containerRef.current.requestFullscreen();
  };

  return (
    <div
      ref={containerRef}
      className={`flex flex-col gap-4 ${fullscreen ? "h-screen justify-center bg-bg p-6" : "h-full"}`}
    >
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
              onClick={() => setShowTrades((visible) => !visible)}
              aria-pressed={showTrades}
              className={`rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors ${
                showTrades
                  ? "border-accent bg-accent-soft text-accent"
                  : "border-line text-muted hover:border-line-strong hover:text-text"
              }`}
            >
              매매
            </button>
          ) : null}
          <button
            type="button"
            onClick={toggleFullscreen}
            className="rounded-lg border border-line px-2.5 py-1 text-xs text-muted transition-colors hover:border-line-strong hover:text-text"
          >
            {fullscreen ? "전체화면 닫기" : "차트 전체화면"}
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5">
        <p className="text-xs text-faint">
          {series.length > 0 ? `${dateLabel(series[0].at)} ~ ${dateLabel(series[series.length - 1].at)} · ` : ""}
          {/* 그린 점(series)이 아니라 구간에 실제로 있는 스냅샷 수다 — 점이 많으면
              솎아서 그리므로 둘이 다르고, 아래 지표는 솎기 전 전체로 계산한다. */}
          {stats.count}개 스냅샷
          {usedFallback ? (
            <span className="ml-1.5 rounded border border-line-strong bg-bg-elevated px-1.5 py-0.5 font-medium text-muted">
              자료 공백으로 최근 관측값 표시 — {ranges.find((r) => r.key === range)?.label} 구간을 다 못 채웠습니다
            </span>
          ) : shortOfRange ? (
            <span className="ml-1.5 rounded border border-line-strong bg-bg-elevated px-1.5 py-0.5 font-medium text-muted">
              기록이 {dateLabel(series[0].at)}부터라 {ranges.find((r) => r.key === range)?.label} 구간을 다 못 채웠습니다 — 아래 지표도 이 구간 기준입니다
            </span>
          ) : null}
        </p>

        {returnPoints.length > 0 || principalPoints.length > 0 || showFx || tradeMarkers.length > 0 ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted">
            <Legend color={stroke} label="총 평가금액" />
            {returnPoints.length > 0 ? <Legend color="var(--accent)" label="원금 대비 수익률" faded /> : null}
            {principalPoints.length > 0 ? <Legend color="var(--text-muted)" label="투입 원금" dashed /> : null}
            {showFx ? <Legend color="var(--fx)" label="환율" dashed /> : null}
            {tradeMarkers.some((marker) => marker.buy > 0) ? <Legend color="var(--up)" label="매수" dashed /> : null}
            {tradeMarkers.some((marker) => marker.sell > 0) ? <Legend color="var(--down)" label="매도" dashed /> : null}
          </div>
        ) : null}
      </div>

      {/* 카드가 옆 칸 높이에 맞춰 늘어나면 차트도 같이 커진다. 높이가 정해지지
          않은 곳(백테스트 상세)에서는 min-h가 예전 고정 높이 역할을 한다. */}
      <div className="relative min-h-[240px] flex-1 sm:min-h-[300px]">
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          preserveAspectRatio="none"
          className={fullscreen ? "h-[70vh] w-full" : "h-full min-h-[240px] w-full sm:min-h-[300px]"}
          role="img"
          aria-label={`총 평가금액 추이, ${ranges.find((r) => r.key === range)?.label} 구간, ${percentSigned(stats.changePercent)}`}
          onMouseLeave={() => setHover(null)}
          onMouseMove={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            // 화면 좌표 -> viewBox 좌표(preserveAspectRatio="none"이라 선형으로 정확히
            // 맞아떨어진다) -> 데이터 인덱스. 그냥 (clientX-rect.left)/rect.width를
            // 바로 인덱스 비율로 썼더니, 차트 좌우 여백(PAD)만큼 실제 마우스 위치와
            // 크로스헤어가 어긋났었다 — xAt()의 역함수를 그대로 써야 정확하다.
            const svgX = ((event.clientX - rect.left) / rect.width) * WIDTH;
            const innerW = WIDTH - PAD.left - PAD.right;
            const ratio = (svgX - PAD.left) / innerW;
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
          {tradeMarkers.map((marker) => (
            <TradeMarker
              key={marker.point.snapshot.at}
              point={marker.point}
              side={marker.side}
              buy={marker.buy}
              sell={marker.sell}
              symbols={marker.symbols}
            />
          ))}
          {principalPoints.length > 0 ? (
            <polyline points={principalLine} fill="none" stroke="var(--text-muted)" strokeWidth="2.2" strokeDasharray="6 3" opacity="0.9" />
          ) : null}
          {showFx ? (
            <polyline points={fxLine} fill="none" stroke="var(--fx)" strokeWidth="1.6" strokeDasharray="2 5" strokeLinecap="round" opacity="0.95" />
          ) : null}
          {returnPoints.length > 0 ? (
            <polyline points={returnLine} fill="none" stroke="var(--accent)" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" opacity="0.55" />
          ) : null}
          <polyline points={line} fill="none" stroke={stroke} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />

          {peak ? <ChartMarker point={peak} label="고점" tone="up" /> : null}
          {mddFrom && mddFrom !== peak ? <ChartMarker point={mddFrom} label="MDD 시작" tone="down" /> : null}
          {mddTo && mddTo !== peak && mddTo !== mddFrom ? <ChartMarker point={mddTo} label="MDD 저점" tone="down" /> : null}

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

        {tradeMarkers.length > 0 ? (
          <ul className="sr-only">
            <li>매매 타점 {tradeMarkers.length}개 — 아래는 각 타점의 날짜와 매수·매도 요약입니다.</li>
            {tradeMarkers.map((marker) => {
              const detail = [
                marker.buy > 0 ? `매수 ${marker.buy}건` : "",
                marker.sell > 0 ? `매도 ${marker.sell}건` : "",
              ]
                .filter(Boolean)
                .join(", ");
              return (
                <li key={marker.point.snapshot.at}>
                  {shortDateTime(marker.point.snapshot.at)}: {detail} ({marker.symbols.join(", ")})
                </li>
              );
            })}
          </ul>
        ) : null}

        <div className="pointer-events-none absolute left-0 top-0 w-max min-w-[180px] rounded-xl border border-line bg-bg-elevated/95 px-3 py-2 text-xs shadow-lg">
          <p className="text-faint">{shortDateTime(active.snapshot.at)}</p>
          <dl className="mt-1 space-y-0.5">
            <TooltipRow label="총 평가금액" value={money(active.snapshot.totalKrw)} emphasis />
            {showFx ? <TooltipRow label="환율" value={active.snapshot.fxRate.toFixed(2)} /> : null}
            {(() => {
              const basis = active.snapshot.principalKrw ?? principalKrw;
              if (!basis || basis <= 0) return null;
              const gainKrw = active.snapshot.totalKrw - basis;
              const gainPercent = (gainKrw / basis) * 100;
              return (
                <>
                  <TooltipRow label="투입 원금" value={money(basis)} />
                  <TooltipRow label="원금 대비 수익률" value={percentSigned(gainPercent)} tone={gainPercent >= 0 ? "up" : "down"} />
                  <TooltipRow label="원금 대비 이익" value={moneySigned(gainKrw)} tone={gainKrw >= 0 ? "up" : "down"} />
                </>
              );
            })()}
          </dl>
          {activeTradeMarker ? (
            <p className="mt-1 border-t border-line pt-1 text-[11px] leading-4">
              {activeTradeMarker.buy > 0 ? <span className="font-semibold text-up">매수 {activeTradeMarker.buy}건 </span> : null}
              {activeTradeMarker.sell > 0 ? <span className="font-semibold text-down">매도 {activeTradeMarker.sell}건 </span> : null}
              <span className="text-muted">{activeTradeMarker.symbols.join(", ")}</span>
            </p>
          ) : null}
        </div>
      </div>

      {/* 전부 지금 보고 있는 구간(stats)의 값이다 — 기간 탭을 바꾸면 같이 바뀐다. */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
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
        {/* 평가액 고점 대비라 입출금이 섞여 있다 — 입출금을 뺀 성과 기준 낙폭은
            주간 리포트에서 따로 낸다(`cashflowAdjustedDrawdown`). */}
        <MiniStat
          label="평가액 낙폭"
          value={percent(stats.maxDrawdown)}
          sub={
            stats.drawdownFrom && stats.drawdownTo
              ? `${shortDateTime(stats.drawdownFrom.at)} → ${shortDateTime(stats.drawdownTo.at)}`
              : undefined
          }
          tone={stats.maxDrawdown < 0 ? "down" : "default"}
        />
        <MiniStat label="현재/최고" value={ratioLabel(stats.vsPeakPercent)} sub={`최고 대비 ${moneySigned(stats.vsPeakAmount)}`} />
        <MiniStat label="현재/최저" value={ratioLabel(stats.vsTroughPercent)} sub={`최저 대비 ${moneySigned(stats.vsTroughAmount)}`} />
      </div>
    </div>
  );
}

/**
 * 최저점 대비 비율은 계좌를 막 열어 잔고가 거의 0이던 날이 구간에 들어오면
 * 백만 %가 넘는 값이 나온다 — 그 구간은 퍼센트 대신 배수로 읽는 게 낫다.
 */
function ratioLabel(value: number) {
  if (!Number.isFinite(value)) return "—";
  if (value < 1000) return percent(value);
  return `×${Math.round(value / 100).toLocaleString("ko-KR")}`;
}

function TradeMarker({
  point,
  side,
  buy,
  sell,
  symbols,
}: {
  point: { x: number; y: number };
  side: "buy" | "sell" | "both";
  buy: number;
  sell: number;
  symbols: string[];
}) {
  const color = side === "buy" ? "var(--up)" : side === "sell" ? "var(--down)" : "var(--accent)";
  const detail = [buy > 0 ? `매수 ${buy}건` : "", sell > 0 ? `매도 ${sell}건` : ""].filter(Boolean).join(" · ");
  // 세로선만 그린다. 평가금액 선 위에 타점마다 점을 찍었더니 타점이 수백 개인
  // 구간에서 그 점들이 이어져 초록색 선처럼 보였고, 정작 평가금액 선이 묻혔다.
  return (
    <g>
      <title>{`${detail} · ${symbols.slice(0, 5).join(", ")}${symbols.length > 5 ? ` 외 ${symbols.length - 5}개` : ""}`}</title>
      <line
        x1={point.x}
        y1={PAD.top}
        x2={point.x}
        y2={HEIGHT - PAD.bottom}
        stroke={color}
        strokeWidth="1.2"
        strokeDasharray="3 4"
        opacity="0.28"
      />
    </g>
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

function TooltipRow({
  label,
  value,
  emphasis = false,
  tone,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
  tone?: "up" | "down";
}) {
  const color = tone === "up" ? "text-up" : tone === "down" ? "text-down" : undefined;
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-faint">{label}</dt>
      <dd className={`tnum ${emphasis ? "text-sm font-bold" : "font-semibold"} ${color ?? ""}`}>{value}</dd>
    </div>
  );
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
