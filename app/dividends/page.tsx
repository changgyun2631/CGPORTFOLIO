import type { Metadata } from "next";
import Link from "next/link";

import { MonthlyBars } from "@/components/charts/monthly-bars";
import { colorFor } from "@/components/dashboard/palette";
import { Card, Empty, PageTitle, Section, Stat, WeightBar } from "@/components/ui/primitives";
import { loadDividendSummary, loadPortfolio } from "@/lib/data/views";
import { monthsOfYear } from "@/lib/domain/dividends";
import { money, percent } from "@/lib/format";

export const metadata: Metadata = { title: "배당" };

// loadDividendSummary/loadPortfolio가 cron이 갱신하는 시세·잔고를 쓰므로,
// 재빌드 없이 다음 요청에서 바로 반영돼야 한다.
export const dynamic = "force-dynamic";

export default async function DividendsPage({ searchParams }: { searchParams: Promise<{ year?: string }> }) {
  const [summary, portfolio, params] = await Promise.all([loadDividendSummary(), loadPortfolio(), searchParams]);

  if (summary.byYear.length === 0) {
    return (
      <div className="space-y-8">
        <PageTitle title="배당" />
        <Empty title="배당 기록이 없습니다" description="data/dividends.json 에 수령 내역이 쌓이면 여기에 집계됩니다." />
      </div>
    );
  }

  const years = summary.byYear.map((y) => y.year); // byYear는 이미 최신순으로 정렬돼 있다.
  // 쿼리로 준 연도가 실제로 있으면 그걸 쓰고, 없으면(또는 안 주면) 가장 최근 연도를 기본값으로 한다.
  const year = params.year && years.includes(params.year) ? params.year : years[0];
  const selected = summary.byYear.find((y) => y.year === year)!;
  // 종목마다 달이 바뀌어도 같은 색을 쓰도록, 배당 총액이 큰 순서로 색 순서를 고정해 둔다.
  const symbolOrder = summary.bySymbol.map((s) => s.symbolId);

  const yieldOnValue = portfolio.totals.totalKrw > 0 ? (summary.forecastKrw / portfolio.totals.totalKrw) * 100 : 0;
  const yieldOnCost = portfolio.totals.costKrw > 0 ? (summary.forecastKrw / portfolio.totals.costKrw) * 100 : 0;
  const topSymbol = summary.bySymbol[0];

  return (
    <div className="space-y-8">
      <PageTitle
        title="배당"
        description="실제 수령한 세후 금액 기준입니다. 연간 예상은 최근 12개월 실지급액을 바탕으로 계산합니다."
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="연간 예상 배당" value={money(summary.forecastKrw)} sub={summary.forecastIsEstimated ? "일부 종목은 배당률 추정치" : "실지급 기준"} />
        <Stat label="올해 수령" value={money(summary.thisYearKrw)} sub={`누적 ${money(summary.totalKrw)}`} />
        <Stat label="평가금액 대비" value={percent(yieldOnValue)} sub={`매입금 대비 ${percent(yieldOnCost)}`} />
        <Stat
          label="최다 지급 종목"
          value={topSymbol?.symbolId ?? "—"}
          sub={topSymbol ? `${money(topSymbol.totalKrw)} · ${topSymbol.count}회` : undefined}
          href={topSymbol ? `/symbols/${encodeURIComponent(topSymbol.symbolId)}` : undefined}
        />
      </div>

      <Section
        title={`${year}년`}
        description={`합계 ${money(selected.totalKrw)}`}
        action={
          years.length > 1 ? (
            <div className="flex flex-wrap gap-1.5">
              {years.map((y) => (
                <Link
                  key={y}
                  href={`/dividends?year=${y}`}
                  aria-current={y === year ? "page" : undefined}
                  className={`rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${
                    y === year ? "bg-accent text-white" : "border border-line text-muted hover:border-line-strong hover:text-text"
                  }`}
                >
                  {y}
                </Link>
              ))}
            </div>
          ) : undefined
        }
      >
        <Card>
          <MonthlyBars months={monthsOfYear(summary, year)} symbolOrder={symbolOrder} />
          {symbolOrder.length > 1 ? (
            <ul className="mt-4 flex flex-wrap gap-x-4 gap-y-2 border-t border-line pt-4 text-sm">
              {summary.bySymbol.map((line, index) => (
                <li key={line.symbolId} className="flex items-center gap-1.5">
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: colorFor(index) }} />
                  <span className="font-bold tracking-tight">{line.symbolId}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </Card>
      </Section>

      <Section title="종목별 누적" description="지급 이력이 있는 종목만 표시합니다.">
        <Card>
          <ul className="space-y-3.5">
            {summary.bySymbol.map((line) => {
              const weight = summary.totalKrw > 0 ? (line.totalKrw / summary.totalKrw) * 100 : 0;
              return (
                <li key={line.symbolId}>
                  <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-[15px]">
                    <Link href={`/symbols/${encodeURIComponent(line.symbolId)}`} className="flex min-w-0 max-w-full items-baseline gap-2 hover:text-accent">
                      <span className="font-bold tracking-tight">{line.symbolId}</span>
                      <span className="truncate text-xs text-faint">{line.name}</span>
                    </Link>
                    <span className="tnum shrink-0 font-semibold">
                      {money(line.totalKrw)}
                      <span className="ml-2 text-xs font-normal text-muted">
                        {line.count}회 · {percent(weight, 1)}
                      </span>
                    </span>
                  </div>
                  <WeightBar weight={weight} />
                </li>
              );
            })}
          </ul>
        </Card>
      </Section>
    </div>
  );
}
