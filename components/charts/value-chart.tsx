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
/** 그리는 점의 상한. 5년 × 365일보다 넉넉히 잡아 하루 한 점을 솎지 않게 한다. */
const MAX_POINTS = 2000;
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
  /** 짚은 점 위에 상자를 띄우려면 SVG가 화면에서 실제로 몇 px인지 알아야 한다.
      viewBox 좌표(1000×300)를 그 비율로 곱해 화면 좌표로 바꾼다. */
  const [svgBox, setSvgBox] = useState<{ width: number; height: number } | null>(null);
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
    // 긴 구간은 filterSnapshots가 이미 하루 한 점으로 접어 오므로 날짜를 더 솎지
    // 않는다 — 연중·1년에서도 하루가 한 점이어야 자세히 볼 수 있다. 상한은 5년치
    // 하루 한 점을 넘는 비정상적인 경우만 막는 안전장치이고, 그때도 최고점과
    // 최저점은 반드시 남긴다.
    const series = downsample(filtered, MAX_POINTS, (s) => s.at === stats.peak?.at || s.at === stats.trough?.at);

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

  // 원금 대비 이익(평가금액 − 원금). 입출금은 평가금액과 원금에 똑같이 들어가 상쇄되므로
  // 이 값의 변화가 입출금을 뺀 순수 손익이다.
  const gainOf = (s: Snapshot) => {
    const basis = s.principalKrw ?? principalKrw;
    return basis && basis > 0 ? s.totalKrw - basis : null;
  };
  // 전일 대비 이익: 짚은 날짜 바로 앞 날짜의 마지막 점과 비교한다. 구간 첫날은 비교할 전일이 없다.
  const activeIndex = points.indexOf(active);
  const activeDay = dateLabel(active.snapshot.at);
  let prevSnapshot: Snapshot | null = null;
  for (let i = activeIndex - 1; i >= 0; i--) {
    if (dateLabel(points[i].snapshot.at) !== activeDay) {
      prevSnapshot = points[i].snapshot;
      break;
    }
  }
  const activeGain = gainOf(active.snapshot);
  const prevGain = prevSnapshot ? gainOf(prevSnapshot) : null;
  const dayGain = activeGain !== null && prevGain !== null ? activeGain - prevGain : null;

  // 기간 수익률: 구간 첫 점 → 끝 점의 이익 증가분을 (시작 평가금액 + 구간 중 순입금)으로 나눈다.
  // 평가금액 증감률(stats.changePercent)은 입금만 해도 오르므로 입출금을 걷어낸 값이다.
  const first = series[0];
  const last = series[series.length - 1];
  const firstGain = gainOf(first);
  const lastGain = gainOf(last);
  const periodGain = firstGain !== null && lastGain !== null ? lastGain - firstGain : null;
  const periodBase =
    periodGain !== null
      ? first.totalKrw + ((last.principalKrw ?? principalKrw ?? 0) - (first.principalKrw ?? principalKrw ?? 0))
      : 0;
  const periodPercent = periodGain !== null && periodBase > 0 ? (periodGain / periodBase) * 100 : null;

  const toggleFullscreen = () => {
    if (!containerRef.current) return;
    if (document.fullscreenElement) document.exitFullscreen();
    else containerRef.current.requestFullscreen();
  };

  return (
    <div
      ref={containerRef}
      className={`@container flex flex-col gap-4 ${fullscreen ? "h-screen justify-center bg-bg p-6" : "h-full"}`}
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
          {/* 구간에 있는 스냅샷 수다. 긴 구간은 하루 한 점으로 접은 뒤라(metrics의
              collapseDaily) 사실상 날짜 수이고, 상한(MAX_POINTS)을 넘지 않는 한 그린
              점 수와도 같다. */}
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
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted">
            <Legend color={stroke} label="총 평가금액" />
            {returnPoints.length > 0 ? <Legend color="var(--accent)" label="원금 대비 수익률" /> : null}
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
        {/* SVG는 preserveAspectRatio="none"으로 늘어나서 그 안의 글자·점도 같이 찌그러진다.
            선과 면만 SVG로 그리고, 글자와 점은 위에 HTML로 얹어 어떤 폭에서도 모양을 지킨다. */}
        <div className={`relative ${fullscreen ? "h-[70vh]" : "h-full min-h-[240px] sm:min-h-[300px]"}`}>
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          preserveAspectRatio="none"
          className="h-full w-full"
          role="img"
          aria-label={`총 평가금액 추이, ${ranges.find((r) => r.key === range)?.label} 구간, ${percentSigned(stats.changePercent)}`}
          onMouseLeave={() => setHover(null)}
          onMouseMove={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            // 화면 좌표 -> viewBox 좌표(preserveAspectRatio="none"이라 선형으로 정확히
            // 맞아떨어진다) -> 데이터 인덱스. 그냥 (clientX-rect.left)/rect.width를
            // 바로 인덱스 비율로 썼더니, 차트 좌우 여백(PAD)만큼 실제 마우스 위치와
            // 크로스헤어가 어긋났었다 — xAt()의 역함수를 그대로 써야 정확하다.
            setSvgBox({ width: rect.width, height: rect.height });
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
                <line x1={PAD.left} y1={y} x2={WIDTH - PAD.right} y2={y} stroke="var(--grid)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
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

          <line x1={active.x} y1={PAD.top} x2={active.x} y2={HEIGHT - PAD.bottom} stroke="var(--border-strong)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        </svg>

        <div className="pointer-events-none absolute inset-0 whitespace-nowrap text-[11px]">
          {[0, 0.25, 0.5, 0.75, 1].map((t) => (
            <span
              key={t}
              className="tnum absolute -translate-x-full -translate-y-1/2 pr-1.5 text-faint"
              style={{ left: pctX(PAD.left), top: pctY(PAD.top + t * innerH) }}
            >
              {(valueAtY(t) / axisUnit).toFixed(1)}
              {axisSuffix}
            </span>
          ))}

          {/* 이름만 있으면 결국 호버해서 값을 봐야 해서, 금액·날짜·낙폭을 꼬리표에 같이 적는다. */}
          {peak ? (
            <ChartMarker
              point={peak}
              label={`고점 ${(peak.snapshot.totalKrw / axisUnit).toFixed(2)}${axisSuffix} · ${monthDay(peak.snapshot.at)}`}
              tone="up"
            />
          ) : null}
          {mddFrom && mddFrom !== peak ? <ChartMarker point={mddFrom} label={`MDD 시작 · ${monthDay(mddFrom.snapshot.at)}`} tone="down" /> : null}
          {mddTo && mddTo !== peak && mddTo !== mddFrom ? (
            <ChartMarker point={mddTo} label={`MDD ${percent(stats.maxDrawdown, 1)} · ${monthDay(mddTo.snapshot.at)}`} tone="down" />
          ) : null}

          <Dot point={active} color={stroke} />

          {/* 오른쪽 여백에 각 선의 최근값(또는 축 상하한)을 숫자로 적는다 — 호버해야만
              보이던 걸 항상 보이게 해달라는 요청(2026-09-21). 선끼리 y가 가까우면
              글자가 겹치므로, 위에서 아래로 정렬한 뒤 최소 간격만큼 밀어낸다. */}
          {(() => {
            const MIN_GAP = 14;
            const labels: { y: number; color: string; bold?: boolean; text: string }[] = [];
            if (returnPoints.length > 0) {
              labels.push({ y: PAD.top, color: "var(--accent)", text: percentSigned(returnMax) });
              labels.push({ y: HEIGHT - PAD.bottom, color: "var(--accent)", text: percentSigned(returnMin) });
            }
            if (points.length > 0) {
              const last = points[points.length - 1];
              labels.push({ y: last.y, color: stroke, bold: true, text: `${(last.snapshot.totalKrw / axisUnit).toFixed(2)}${axisSuffix}` });
            }
            if (principalPoints.length > 0) {
              const last = principalPoints[principalPoints.length - 1];
              const basis = series[series.length - 1].principalKrw ?? principalKrw ?? 0;
              labels.push({ y: last.y, color: "var(--text-muted)", text: `${(basis / axisUnit).toFixed(2)}${axisSuffix}` });
            }
            if (showFx && fxPoints.length > 0) {
              const last = fxPoints[fxPoints.length - 1];
              labels.push({ y: last.y, color: "var(--fx)", text: series[series.length - 1].fxRate.toFixed(1) });
            }

            const placed = [...labels].sort((a, b) => a.y - b.y).reduce<typeof labels>((acc, label) => {
              const prevY = acc.at(-1)?.y ?? -Infinity;
              acc.push({ ...label, y: Math.max(label.y, prevY + MIN_GAP) });
              return acc;
            }, []);

            return placed.map((label, i) => (
              <span
                key={i}
                className={`tnum absolute -translate-y-1/2 pl-1.5 ${label.bold ? "font-bold" : ""}`}
                style={{ left: pctX(WIDTH - PAD.right), top: pctY(label.y), color: label.color }}
              >
                {label.text}
              </span>
            ));
          })()}
        </div>
        </div>

        {/* 짚은 점의 살짝 왼쪽 위에 띄운다. 예전에는 차트 왼쪽 위 구석에 고정이라
            어느 점을 말하는지 눈으로 이어붙여야 했다. 점이 왼쪽 끝이나 위쪽 끝에
            있으면 상자가 차트 밖으로 나가므로 반대쪽으로 뒤집는다. */}
        {hover !== null && svgBox
          ? (() => {
              const left = (active.x / WIDTH) * svgBox.width;
              const top = (active.y / HEIGHT) * svgBox.height;
              const toRight = left < svgBox.width * 0.3;
              const below = top < svgBox.height * 0.4;
              return (
                <div
                  className="pointer-events-none absolute z-10 w-max min-w-[180px] rounded-xl border border-line bg-bg-elevated/95 px-3 py-2 text-xs shadow-lg"
                  style={{
                    left,
                    top,
                    transform: `translate(${toRight ? "12px" : "calc(-100% - 12px)"}, ${below ? "12px" : "calc(-100% - 12px)"})`,
                  }}
                >
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
                          {dayGain !== null ? (
                            <TooltipRow label="전일 대비 이익" value={moneySigned(dayGain)} tone={dayGain >= 0 ? "up" : "down"} />
                          ) : null}
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
              );
            })()
          : null}

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
      </div>

      {/* 전부 지금 보고 있는 구간(stats)의 값이다 — 기간 탭을 바꾸면 같이 바뀐다. */}
      {/* 칸 수는 화면이 아니라 카드 폭을 따른다 — 대시보드처럼 옆 칸과 나눠 쓰면 화면은
          넓어도 카드가 좁아서, 6칸이면 금액이 두 줄로 꺾이고 부제가 잘렸다. */}
      <div className="grid grid-cols-2 gap-2 @lg:grid-cols-3 @4xl:grid-cols-6">
        <MiniStat
          label={`${ranges.find((r) => r.key === range)?.label} 수익률`}
          value={periodPercent === null ? "—" : percentSigned(periodPercent)}
          sub={periodGain === null ? undefined : `기간 이익 ${moneySigned(periodGain)}`}
          tone={periodPercent === null ? "default" : periodPercent >= 0 ? "up" : "down"}
        />
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

/** "2026-08-12" → "8/12" */
function monthDay(iso: string) {
  const [, m, d] = dateLabel(iso).split("-");
  return `${Number(m)}/${Number(d)}`;
}

/** viewBox 좌표를 겹쳐 얹은 HTML의 % 위치로 바꾼다. */
const pctX = (x: number) => `${(x / WIDTH) * 100}%`;
const pctY = (y: number) => `${(y / HEIGHT) * 100}%`;

function Dot({ point, color }: { point: { x: number; y: number }; color: string }) {
  return (
    <span
      className="absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-bg"
      style={{ left: pctX(point.x), top: pctY(point.y), background: color }}
    />
  );
}

function ChartMarker({ point, label, tone }: { point: { x: number; y: number }; label: string; tone: "up" | "down" }) {
  const color = tone === "up" ? "var(--up)" : "var(--down)";
  // 차트 양 끝에 있으면 꼬리표가 잘리므로 가운데 정렬 대신 안쪽으로 붙인다.
  const shift = point.x < WIDTH * 0.15 ? "0%" : point.x > WIDTH * 0.85 ? "-100%" : "-50%";
  // 고점은 늘 맨 위라 위에 달면 차트 밖(범례)으로 나간다 — 위쪽 점은 아래에 단다.
  const dy = point.y < HEIGHT * 0.25 ? "8px" : "calc(-100% - 8px)";
  return (
    <>
      <Dot point={point} color={color} />
      <span
        className="absolute whitespace-nowrap rounded-full border bg-bg-elevated px-2 py-0.5 text-[11px] font-bold leading-4"
        style={{
          left: pctX(point.x),
          top: pctY(point.y),
          transform: `translate(${shift}, ${dy})`,
          color,
          borderColor: `color-mix(in srgb, ${color} 60%, transparent)`,
        }}
      >
        {label}
      </span>
    </>
  );
}

/** 상자 안의 이름-값 한 줄. 숫자는 tnum으로 폭이 덜 흔들리게 한다. */
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

function Legend({ color, label, dashed = false }: { color: string; label: string; dashed?: boolean }) {
  return (
    <span className="flex items-center gap-1">
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
