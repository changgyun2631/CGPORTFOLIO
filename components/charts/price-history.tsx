import { groupTradeMarkers, type ChartTrade } from "@/lib/domain/trade-markers";
import { price as fmtPrice } from "@/lib/format";

/**
 * 종목 상세의 가격 추이. 서버에서 그대로 그려 보내는 정적 SVG다.
 * 기간 조작이 필요 없는 자리라 상호작용을 넣지 않았다 — 다만 언제 사고 팔았는지는
 * 알아야 하니 매매 타점(세로 점선)은 그린다.
 */
export function PriceHistory({
  points,
  currency,
  trades = [],
  height = 220,
}: {
  points: { d: string; c: number }[];
  currency: "KRW" | "USD";
  trades?: ChartTrade[];
  height?: number;
}) {
  if (points.length < 2) {
    return <p className="py-8 text-center text-sm text-muted">가격 이력이 없습니다.</p>;
  }

  const WIDTH = 1000;
  const PAD = 12;
  const values = points.map((p) => p.c);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const innerH = height - PAD * 2;

  const xAt = (i: number) => (i / (points.length - 1)) * WIDTH;
  const yAt = (value: number) => PAD + innerH - ((value - min) / span) * innerH;

  const coords = points.map((p, i) => `${xAt(i).toFixed(1)},${yAt(p.c).toFixed(1)}`);

  const rising = values[values.length - 1] >= values[0];
  const stroke = rising ? "var(--up)" : "var(--down)";
  const line = coords.join(" ");

  // 거래 시각(ISO datetime)을 가격 이력의 날짜(YYYY-MM-DD) 인덱스에 매핑한다 —
  // ValueChart의 매매 타점과 같은 그룹화 로직을 재사용한다.
  const tradeGroups = groupTradeMarkers(
    points.map((p) => p.d),
    trades,
  );

  return (
    <div>
      <svg viewBox={`0 0 ${WIDTH} ${height}`} className="w-full" style={{ height }} role="img" aria-label="가격 추이">
        <defs>
          <linearGradient id="price-area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={stroke} stopOpacity="0.22" />
            <stop offset="100%" stopColor={stroke} stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0, 0.5, 1].map((t) => (
          <line key={t} x1="0" y1={PAD + t * innerH} x2={WIDTH} y2={PAD + t * innerH} stroke="var(--grid)" strokeWidth="1" />
        ))}
        <polygon points={`${line} ${WIDTH},${height} 0,${height}`} fill="url(#price-area)" />
        {tradeGroups.map((group) => {
          const x = xAt(group.snapshotIndex);
          const color = group.side === "buy" ? "var(--up)" : group.side === "sell" ? "var(--down)" : "var(--accent)";
          const detail = [group.buy > 0 ? `매수 ${group.buy}건` : "", group.sell > 0 ? `매도 ${group.sell}건` : ""]
            .filter(Boolean)
            .join(" · ");
          return (
            <g key={points[group.snapshotIndex].d}>
              <title>{`${points[group.snapshotIndex].d} · ${detail}`}</title>
              <line x1={x} y1={PAD} x2={x} y2={height - PAD} stroke={color} strokeWidth="1.2" strokeDasharray="3 4" opacity="0.55" />
              <circle cx={x} cy={yAt(points[group.snapshotIndex].c)} r="3.5" fill={color} stroke="var(--bg)" strokeWidth="1.5" />
            </g>
          );
        })}
        <polyline points={line} fill="none" stroke={stroke} strokeWidth="1.8" strokeLinejoin="round" />
      </svg>

      {tradeGroups.length > 0 ? (
        <ul className="sr-only">
          <li>매매 타점 {tradeGroups.length}개</li>
          {tradeGroups.map((group) => (
            <li key={points[group.snapshotIndex].d}>
              {points[group.snapshotIndex].d}: {group.buy > 0 ? `매수 ${group.buy}건 ` : ""}
              {group.sell > 0 ? `매도 ${group.sell}건 ` : ""}({group.symbols.join(", ")})
            </li>
          ))}
        </ul>
      ) : null}

      <div className="mt-2 flex justify-between text-[11px] text-faint">
        <span>
          {points[0].d} · {fmtPrice(points[0].c, currency)}
        </span>
        <span className="tnum">
          최저 {fmtPrice(min, currency)} · 최고 {fmtPrice(max, currency)}
        </span>
        <span>
          {points[points.length - 1].d} · {fmtPrice(points[points.length - 1].c, currency)}
        </span>
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
