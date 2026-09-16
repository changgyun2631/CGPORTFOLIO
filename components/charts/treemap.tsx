import { squarify } from "@/lib/domain/treemap";
import { money, percentSigned } from "@/lib/format";

/**
 * 자산맵. 면적은 평가금액, 색은 전일 등락률.
 * 작은 칸에는 글자가 들어가지 않으므로 칸 크기에 따라 표시 단계를 낮춘다.
 */

export type TreemapDatum = {
  key: string;
  label: string;
  name?: string;
  value: number;
  changePercent: number;
};

/**
 * 등락률을 색 농도로 바꾼다. ±3%에서 가장 진해진다.
 * 상승 초록·하락 빨강(핀비즈 등 미국식). 화면의 나머지 등락 표시(`--up`/`--down`)와도
 * 같은 방향이라, 여기만 반대였던 걸 맞췄다.
 */
function toneFor(changePercent: number) {
  const clamped = Math.max(Math.min(changePercent / 3, 1), -1);
  const intensity = Math.abs(clamped);
  if (Math.abs(changePercent) < 0.03) {
    return { background: "var(--surface)", border: "var(--border)", text: "var(--text-muted)" };
  }
  const base = clamped > 0 ? "34, 197, 94" : "239, 68, 68";
  return {
    background: `rgba(${base}, ${(0.16 + intensity * 0.55).toFixed(3)})`,
    border: `rgba(${base}, ${(0.35 + intensity * 0.4).toFixed(3)})`,
    text: intensity > 0.45 ? "#ffffff" : "var(--text)",
  };
}

export function Treemap({
  data,
  width = 1000,
  height = 520,
  className = "",
}: {
  data: TreemapDatum[];
  width?: number;
  height?: number;
  className?: string;
}) {
  const byKey = new Map(data.map((d) => [d.key, d]));
  const tiles = squarify(
    data.map((d) => ({ key: d.key, value: d.value })),
    width,
    height,
  );

  if (tiles.length === 0) {
    return <p className="py-10 text-center text-sm text-muted">표시할 자산이 없습니다.</p>;
  }

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className={`w-full ${className}`}
      role="img"
      aria-label={`자산맵, ${data.length}개 종목`}
      preserveAspectRatio="xMidYMid meet"
    >
      {tiles.map((tile) => {
        const datum = byKey.get(tile.key);
        if (!datum) return null;
        const tone = toneFor(datum.changePercent);

        const area = tile.width * tile.height;
        const showLabel = tile.width > 34 && tile.height > 20;
        const showChange = tile.width > 52 && tile.height > 36;
        const showValue = tile.width > 96 && tile.height > 62;
        // 큰 칸일수록 글자를 키우되 상한을 둔다.
        const labelSize = Math.max(9, Math.min(Math.sqrt(area) / 6.5, 20));

        const cx = tile.x + tile.width / 2;
        const cy = tile.y + tile.height / 2;

        return (
          <g key={tile.key}>
            <rect
              x={tile.x + 1}
              y={tile.y + 1}
              width={Math.max(tile.width - 2, 0)}
              height={Math.max(tile.height - 2, 0)}
              rx={Math.min(5, tile.width / 6, tile.height / 6)}
              fill={tone.background}
              stroke={tone.border}
              strokeWidth="1"
            />
            <title>{`${datum.label}${datum.name ? ` · ${datum.name}` : ""}\n${money(datum.value)}\n${percentSigned(datum.changePercent)}`}</title>
            {showLabel ? (
              <text
                x={cx}
                y={showChange ? cy - labelSize * 0.25 : cy}
                textAnchor="middle"
                dominantBaseline="middle"
                fill={tone.text}
                fontSize={labelSize}
                fontWeight="700"
                style={{ pointerEvents: "none" }}
              >
                {datum.label}
              </text>
            ) : null}
            {showChange ? (
              <text
                x={cx}
                y={cy + labelSize * 0.85}
                textAnchor="middle"
                dominantBaseline="middle"
                fill={tone.text}
                fontSize={Math.max(8, labelSize * 0.62)}
                opacity="0.95"
                style={{ pointerEvents: "none" }}
              >
                {percentSigned(datum.changePercent)}
              </text>
            ) : null}
            {showValue ? (
              <text
                x={cx}
                y={cy + labelSize * 1.95}
                textAnchor="middle"
                dominantBaseline="middle"
                fill={tone.text}
                fontSize={Math.max(8, labelSize * 0.55)}
                opacity="0.8"
                style={{ pointerEvents: "none" }}
              >
                {money(datum.value)}
              </text>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}

/** 자산맵 색 범례. */
export function TreemapLegend() {
  const steps = [-3, -1.5, 0, 1.5, 3];
  return (
    <div className="flex items-center gap-2 text-[11px] text-faint">
      <span>-3%</span>
      <div className="flex h-2.5 overflow-hidden rounded-full">
        {steps.map((step, index) => {
          const from = toneFor(step);
          return <div key={index} className="h-full w-8" style={{ background: from.background }} />;
        })}
      </div>
      <span>+3%</span>
    </div>
  );
}
