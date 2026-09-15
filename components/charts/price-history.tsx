import { price as fmtPrice } from "@/lib/format";

/**
 * 종목 상세의 가격 추이. 서버에서 그대로 그려 보내는 정적 SVG다.
 * 기간 조작이 필요 없는 자리라 상호작용을 넣지 않았다.
 */
export function PriceHistory({
  points,
  currency,
  height = 220,
}: {
  points: { d: string; c: number }[];
  currency: "KRW" | "USD";
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

  const coords = points.map((p, i) => {
    const x = (i / (points.length - 1)) * WIDTH;
    const y = PAD + innerH - ((p.c - min) / span) * innerH;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  const rising = values[values.length - 1] >= values[0];
  const stroke = rising ? "var(--up)" : "var(--down)";
  const line = coords.join(" ");

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
        <polyline points={line} fill="none" stroke={stroke} strokeWidth="1.8" strokeLinejoin="round" />
      </svg>

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
    </div>
  );
}
