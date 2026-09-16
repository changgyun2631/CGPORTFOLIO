"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import type { Holding } from "@/lib/domain/portfolio";
import { money, percent } from "@/lib/format";

import { colorFor } from "./palette";

const PAGE_SIZE = 10;
const ROTATE_MS = 4000;

/**
 * 한 줄짜리 누적 막대 + 범례. 총 평가금액 카드 아래에 붙는다.
 * `paginate`를 주면 비중이 큰 순서로 10종목씩 페이지를 나눠, 몇 초마다 자동으로
 * 다음 페이지로 넘어간다(마우스를 올리면 멈춘다) — 대시보드처럼 옆에 차트를
 * 나란히 두는 좁은 칸에서 보유 종목 수만큼 목록이 한없이 길어지는 걸 막는다.
 * 클릭으로 페이지를 직접 고르는 버튼은 없다 — 사용자가 명시적으로 원한 방식이다.
 */
export function AllocationBar({ holdings, paginate = false }: { holdings: Holding[]; paginate?: boolean }) {
  const total = holdings.reduce((sum, h) => sum + h.valueKrw, 0);
  const sorted = [...holdings].sort((a, b) => b.weight - a.weight);
  const pageCount = paginate ? Math.max(1, Math.ceil(sorted.length / PAGE_SIZE)) : 1;

  const [page, setPage] = useState(0);
  const [paused, setPaused] = useState(false);
  // 종목 수가 바뀌어(예: 가져오기 반영 직후) 저장된 page가 범위를 벗어나도,
  // state를 따로 고치는 effect 없이 나머지 연산으로 안전한 값을 유도한다.
  const safePage = page % pageCount;

  useEffect(() => {
    if (!paginate || pageCount <= 1 || paused) return;
    const id = setInterval(() => setPage((p) => (p + 1) % pageCount), ROTATE_MS);
    return () => clearInterval(id);
  }, [paginate, pageCount, paused]);

  if (total <= 0) return null;

  const listed = paginate ? sorted.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE) : sorted;

  return (
    <div className="space-y-4" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-bg-elevated">
        {sorted.map((holding, index) => (
          <div
            key={holding.symbolId}
            className="h-full first:rounded-l-full last:rounded-r-full"
            style={{ width: `${holding.weight}%`, background: colorFor(index) }}
            title={`${holding.symbolId} ${percent(holding.weight)}`}
          />
        ))}
      </div>

      <ul className="space-y-2">
        {listed.map((holding) => {
          const colorIndex = sorted.indexOf(holding);
          return (
            <li key={holding.symbolId}>
              <Link
                href={`/symbols/${encodeURIComponent(holding.symbolId)}`}
                className="flex items-center gap-3 rounded-lg px-1.5 py-1.5 transition-colors hover:bg-surface-hover"
              >
                <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: colorFor(colorIndex) }} />
                <span className="w-[62px] shrink-0 text-[12px] font-bold tracking-tight">{holding.symbolId}</span>
                <span className="min-w-0 flex-1 truncate text-[11px] text-muted">{holding.name}</span>
                <span className="tnum w-[52px] shrink-0 text-right text-[12px] font-semibold">{percent(holding.weight, 1)}</span>
                <span className="tnum hidden w-[124px] shrink-0 text-right text-[12px] text-muted sm:block">
                  {money(holding.valueKrw)}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>

      {paginate && pageCount > 1 ? (
        <div className="flex items-center justify-center gap-1.5 pt-1" aria-hidden="true">
          {Array.from({ length: pageCount }, (_, i) => (
            <span
              key={i}
              className={`h-1.5 rounded-full transition-all ${i === safePage ? "w-4 bg-accent" : "w-1.5 bg-line"}`}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
