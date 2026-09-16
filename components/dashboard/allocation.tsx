import Link from "next/link";

import type { Holding } from "@/lib/domain/portfolio";
import { money, percent } from "@/lib/format";

/** 비중 순서대로 색을 돌려 쓴다. 종목 수가 늘어도 인접한 칸이 같은 색이 되지 않게. */
const palette = [
  "#4f8cff",
  "#22c9a8",
  "#f0a04b",
  "#9b7bf0",
  "#f0616d",
  "#3dc9e8",
  "#c9d14b",
  "#e87ab8",
  "#6b7ae8",
  "#54b36a",
];

export function colorFor(index: number) {
  return palette[index % palette.length];
}

/**
 * 한 줄짜리 누적 막대 + 범례. 총 평가금액 카드 아래에 붙는다.
 * `limit`을 주면 비중이 큰 순서로 그만큼만 목록에 나열한다(누적 막대 자체는
 * 항상 전체 종목으로 그린다) — 대시보드처럼 옆에 차트를 나란히 두는 좁은 칸에서
 * 보유 종목 수만큼 목록이 한없이 길어지는 걸 막는다. 나머지는 "종목 전체" 링크로.
 */
export function AllocationBar({ holdings, limit }: { holdings: Holding[]; limit?: number }) {
  const total = holdings.reduce((sum, h) => sum + h.valueKrw, 0);
  if (total <= 0) return null;

  const sorted = [...holdings].sort((a, b) => b.weight - a.weight);
  const listed = limit ? sorted.slice(0, limit) : sorted;
  const hiddenCount = sorted.length - listed.length;

  return (
    <div className="space-y-4">
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-bg-elevated">
        {holdings.map((holding, index) => (
          <div
            key={holding.symbolId}
            className="h-full first:rounded-l-full last:rounded-r-full"
            style={{ width: `${holding.weight}%`, background: colorFor(index) }}
            title={`${holding.symbolId} ${percent(holding.weight)}`}
          />
        ))}
      </div>

      <ul className="space-y-2">
        {listed.map((holding, index) => (
          <li key={holding.symbolId}>
            <Link
              href={`/symbols/${encodeURIComponent(holding.symbolId)}`}
              className="flex items-center gap-3 rounded-lg px-1.5 py-1.5 transition-colors hover:bg-surface-hover"
            >
              <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: colorFor(index) }} />
              <span className="w-[62px] shrink-0 text-[12px] font-bold tracking-tight">{holding.symbolId}</span>
              <span className="min-w-0 flex-1 truncate text-[11px] text-muted">{holding.name}</span>
              <span className="tnum w-[52px] shrink-0 text-right text-[12px] font-semibold">{percent(holding.weight, 1)}</span>
              <span className="tnum hidden w-[124px] shrink-0 text-right text-[12px] text-muted sm:block">
                {money(holding.valueKrw)}
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {hiddenCount > 0 ? <p className="text-[11px] text-faint">+{hiddenCount}개 종목 더</p> : null}
    </div>
  );
}
