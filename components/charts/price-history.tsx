"use client";

import { useMemo, useState } from "react";

import { groupTradeMarkers, type ChartTrade } from "@/lib/domain/trade-markers";
import { dateLabel, moneySigned, price as fmtPrice } from "@/lib/format";

/**
 * 종목 상세의 가격 추이. 마우스를 올리면 그 날짜의 종가를 보여준다
 * (ValueChart의 호버 패턴과 같은 방식). 매매 타점(세로 점선)도 같이 그린다.
 *
 * 전체 이력(최대 5000거래일 = 약 19년)을 한 번에 다 그리면 너무 조밀해서
 * 기간 탭을 뒀다 — 기본은 5년이다.
 */

const WIDTH = 1000;
const PAD = { top: 14, right: 8, bottom: 24, left: 56 };

type RangeKey = "1y" | "5y" | "max";
const RANGES: { key: RangeKey; label: string; years: number | null }[] = [
  { key: "1y", label: "1년", years: 1 },
  { key: "5y", label: "5년", years: 5 },
  { key: "max", label: "최대", years: null },
];

/** "YYYY-MM-DD" 문자열 기준으로 N년 전 날짜를 계산한다(시간대 변환 없이 문자열만 다룬다). */
function yearsAgo(dateStr: string, years: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(Date.UTC(y - years, m - 1, d));
  return date.toISOString().slice(0, 10);
}

export function PriceHistory({
  points: allPoints,
  currency,
  trades = [],
  height = 240,
}: {
  points: { d: string; c: number }[];
  currency: "KRW" | "USD";
  trades?: ChartTrade[];
  height?: number;
}) {
  const [range, setRange] = useState<RangeKey>("5y");
  const [hover, setHover] = useState<number | null>(null);

  const points = useMemo(() => {
    const rangeDef = RANGES.find((r) => r.key === range);
    if (!rangeDef || rangeDef.years === null || allPoints.length === 0) return allPoints;
    const cutoff = yearsAgo(allPoints[allPoints.length - 1].d, rangeDef.years);
    const filtered = allPoints.filter((p) => p.d >= cutoff);
    // 선택한 기간에 실제 관측값이 거의 없으면(예: 상장한 지 얼마 안 된 종목에서 "5년"을
    // 고른 경우) 빈 차트 대신 있는 전체를 보여준다.
    return filtered.length >= 2 ? filtered : allPoints;
  }, [allPoints, range]);

  if (allPoints.length < 2) {
    return <p className="py-8 text-center text-sm text-muted">가격 이력이 없습니다.</p>;
  }

  const values = points.map((p) => p.c);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const innerW = WIDTH - PAD.left - PAD.right;
  const innerH = height - PAD.top - PAD.bottom;

  const xAt = (i: number) => PAD.left + (points.length === 1 ? innerW / 2 : (i / (points.length - 1)) * innerW);
  const yAt = (value: number) => PAD.top + innerH - ((value - min) / span) * innerH;
  const valueAtY = (t: number) => max - t * span;

  const coords = points.map((p, i) => `${xAt(i).toFixed(1)},${yAt(p.c).toFixed(1)}`);
  const rising = values[values.length - 1] >= values[0];
  const stroke = rising ? "var(--up)" : "var(--down)";
  const line = coords.join(" ");
  const area = `${line} ${xAt(points.length - 1).toFixed(1)},${height - PAD.bottom} ${xAt(0).toFixed(1)},${height - PAD.bottom}`;

  // 거래 시각(ISO datetime)을 가격 이력의 날짜(YYYY-MM-DD) 인덱스에 매핑한다 —
  // ValueChart의 매매 타점과 같은 그룹화 로직을 재사용한다.
  const tradeGroups = groupTradeMarkers(
    points.map((p) => p.d),
    trades,
  );

  const activeIndex = hover === null ? points.length - 1 : Math.min(hover, points.length - 1);
  const active = points[activeIndex];
  const activeTrade = tradeGroups.find((group) => group.snapshotIndex === activeIndex) ?? null;
  const tooltipOnLeft = activeIndex > points.length / 2;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-faint">
          {dateLabel(points[0].d)} ~ {dateLabel(points[points.length - 1].d)} · {points.length}거래일
        </p>
        <div className="flex gap-1">
          {RANGES.map((r) => (
            <button
              key={r.key}
              type="button"
              onClick={() => {
                setRange(r.key);
                setHover(null);
              }}
              aria-pressed={range === r.key}
              className={`rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors ${
                range === r.key ? "bg-accent text-white" : "border border-line text-muted hover:border-line-strong hover:text-text"
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      <div className="relative mt-1">
        <svg
          viewBox={`0 0 ${WIDTH} ${height}`}
          preserveAspectRatio="none"
          className="w-full"
          style={{ height }}
          role="img"
          aria-label={`가격 추이, ${dateLabel(points[0].d)}부터 ${dateLabel(points[points.length - 1].d)}까지`}
          onMouseLeave={() => setHover(null)}
          onMouseMove={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            // 화면 좌표 -> viewBox 좌표(preserveAspectRatio="none"이라 선형으로 정확히
            // 맞아떨어진다) -> 데이터 인덱스. 그냥 (clientX-rect.left)/rect.width를
            // 바로 인덱스 비율로 썼더니, 차트 좌우 여백(PAD)만큼 실제 마우스 위치와
            // 크로스헤어가 어긋났었다 — xAt()의 역함수를 그대로 써야 정확하다.
            const svgX = ((event.clientX - rect.left) / rect.width) * WIDTH;
            const ratio = (svgX - PAD.left) / innerW;
            const index = Math.round(ratio * (points.length - 1));
            setHover(Math.max(0, Math.min(index, points.length - 1)));
          }}
        >
          <defs>
            <linearGradient id="price-area" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={stroke} stopOpacity="0.22" />
              <stop offset="100%" stopColor={stroke} stopOpacity="0" />
            </linearGradient>
          </defs>
          {[0, 0.5, 1].map((t) => {
            const y = PAD.top + t * innerH;
            return (
              <g key={t}>
                <line x1={PAD.left} y1={y} x2={WIDTH - PAD.right} y2={y} stroke="var(--grid)" strokeWidth="1" />
                <text x={PAD.left - 8} y={y + 4} textAnchor="end" fill="var(--text-faint)" fontSize="10">
                  {fmtPrice(valueAtY(t), currency)}
                </text>
              </g>
            );
          })}
          <polygon points={area} fill="url(#price-area)" />
          {tradeGroups.map((group) => {
            const x = xAt(group.snapshotIndex);
            const color = group.side === "buy" ? "var(--up)" : group.side === "sell" ? "var(--down)" : "var(--accent)";
            const detail = [
              group.buy > 0 ? `매수 ${group.buy}건 · ${group.buyShares}주 · 평단 ${fmtPrice(group.buyAvgPrice, currency)}` : "",
              group.sell > 0
                ? `매도 ${group.sell}건 · ${group.sellShares}주 · 평단 ${fmtPrice(group.sellAvgPrice, currency)} · 손익 ${moneySigned(group.sellRealizedKrw)}`
                : "",
            ]
              .filter(Boolean)
              .join(" · ");
            return (
              <g key={points[group.snapshotIndex].d}>
                <title>{`${points[group.snapshotIndex].d} · ${detail}`}</title>
                <line
                  x1={x}
                  y1={PAD.top}
                  x2={x}
                  y2={height - PAD.bottom}
                  stroke={color}
                  strokeWidth="1.2"
                  strokeDasharray="3 4"
                  opacity="0.5"
                />
                <circle cx={x} cy={yAt(points[group.snapshotIndex].c)} r="3.5" fill={color} stroke="var(--bg)" strokeWidth="1.5" />
              </g>
            );
          })}
          <polyline points={line} fill="none" stroke={stroke} strokeWidth="1.8" strokeLinejoin="round" />

          <line x1={xAt(activeIndex)} y1={PAD.top} x2={xAt(activeIndex)} y2={height - PAD.bottom} stroke="var(--border-strong)" strokeWidth="1" />
          <circle cx={xAt(activeIndex)} cy={yAt(active.c)} r="4" fill={stroke} stroke="var(--bg)" strokeWidth="2" />
        </svg>

        <div
          className="pointer-events-none absolute top-0 rounded-xl border border-line bg-bg-elevated/95 px-3 py-2 text-xs shadow-lg"
          style={
            tooltipOnLeft
              ? { right: `${100 - (xAt(activeIndex) / WIDTH) * 100}%` }
              : { left: `${(xAt(activeIndex) / WIDTH) * 100}%` }
          }
        >
          <p className="text-faint">{dateLabel(active.d)}</p>
          <p className="tnum mt-0.5 text-sm font-bold">{fmtPrice(active.c, currency)}</p>
          {activeTrade ? (
            <div className="mt-1 space-y-0.5 border-t border-line pt-1 text-[11px] leading-4">
              {activeTrade.buy > 0 ? (
                <p className="font-semibold text-up">
                  매수 {activeTrade.buy}건 · {activeTrade.buyShares}주 · 평단 {fmtPrice(activeTrade.buyAvgPrice, currency)}
                </p>
              ) : null}
              {activeTrade.sell > 0 ? (
                <p className="font-semibold text-down">
                  매도 {activeTrade.sell}건 · {activeTrade.sellShares}주 · 평단 {fmtPrice(activeTrade.sellAvgPrice, currency)}
                  <br />
                  손익 {moneySigned(activeTrade.sellRealizedKrw)}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      {tradeGroups.length > 0 ? (
        <ul className="sr-only">
          <li>매매 타점 {tradeGroups.length}개</li>
          {tradeGroups.map((group) => (
            <li key={points[group.snapshotIndex].d}>
              {points[group.snapshotIndex].d}:{" "}
              {group.buy > 0 ? `매수 ${group.buy}건 ${group.buyShares}주 평단 ${fmtPrice(group.buyAvgPrice, currency)} ` : ""}
              {group.sell > 0
                ? `매도 ${group.sell}건 ${group.sellShares}주 평단 ${fmtPrice(group.sellAvgPrice, currency)} 손익 ${moneySigned(group.sellRealizedKrw)} `
                : ""}
              ({group.symbols.join(", ")})
            </li>
          ))}
        </ul>
      ) : null}

      <div className="mt-2 flex justify-between text-[11px] text-faint">
        <span className="tnum">최저 {fmtPrice(min, currency)}</span>
        <span className="tnum">최고 {fmtPrice(max, currency)}</span>
      </div>
      {tradeGroups.length > 0 ? (
        <p className="mt-2 flex items-center gap-3 text-[11px] text-muted">
          <span className="flex items-center gap-1">
            <span className="h-0.5 w-3.5" style={{ background: "repeating-linear-gradient(90deg, var(--up) 0 3px, transparent 3px 6px)" }} />
            매수
          </span>
          <span className="flex items-center gap-1">
            <span className="h-0.5 w-3.5" style={{ background: "repeating-linear-gradient(90deg, var(--down) 0 3px, transparent 3px 6px)" }} />
            매도
          </span>
        </p>
      ) : null}
    </div>
  );
}
