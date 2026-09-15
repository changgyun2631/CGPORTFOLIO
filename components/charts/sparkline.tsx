/**
 * 아주 작은 추세선. 티커 스트립과 표 안에 들어간다.
 * 라이브러리 없이 폴리라인 하나로 그린다.
 */
export function Sparkline({
  values,
  width = 96,
  height = 28,
  tone = "auto",
  strokeWidth = 1.5,
  fill = true,
}: {
  values: number[];
  width?: number;
  height?: number;
  /** auto면 첫 값 대비 마지막 값의 방향으로 색을 정한다. */
  tone?: "auto" | "up" | "down" | "flat";
  strokeWidth?: number;
  fill?: boolean;
}) {
  if (values.length < 2) {
    return <svg width={width} height={height} aria-hidden="true" />;
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  // 선이 위아래 모서리에 닿아 잘리지 않도록 여백을 남긴다.
  const pad = strokeWidth;
  const usable = height - pad * 2;

  const points = values.map((value, index) => {
    const x = (index / (values.length - 1)) * width;
    const y = pad + usable - ((value - min) / span) * usable;
    return [x, y] as const;
  });

  const direction = tone === "auto" ? (values[values.length - 1] >= values[0] ? "up" : "down") : tone;
  const stroke = direction === "up" ? "var(--up)" : direction === "down" ? "var(--down)" : "var(--flat)";

  const line = points.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
  const area = `${line} ${width},${height} 0,${height}`;
  const gradientId = `spark-${direction}-${values.length}-${Math.round(min)}`;

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true" className="overflow-visible">
      {fill ? (
        <>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={stroke} stopOpacity="0.28" />
              <stop offset="100%" stopColor={stroke} stopOpacity="0" />
            </linearGradient>
          </defs>
          <polygon points={area} fill={`url(#${gradientId})`} />
        </>
      ) : null}
      <polyline points={line} fill="none" stroke={stroke} strokeWidth={strokeWidth} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
