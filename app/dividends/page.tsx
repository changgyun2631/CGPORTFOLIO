import type { Metadata } from "next";
import Link from "next/link";

import { MonthlyBars } from "@/components/charts/monthly-bars";
import { Card, Empty, PageTitle, Section, Stat, WeightBar } from "@/components/ui/primitives";
import { loadDividendSummary, loadPortfolio } from "@/lib/data/views";
import { monthsOfYear } from "@/lib/domain/dividends";
import { money, percent } from "@/lib/format";

export const metadata: Metadata = { title: "배당" };

export default async function DividendsPage() {
  const [summary, portfolio] = await Promise.all([loadDividendSummary(), loadPortfolio()]);

  if (summary.byYear.length === 0) {
    return (
      <div className="space-y-8">
        <PageTitle title="배당" />
        <Empty title="배당 기록이 없습니다" description="data/dividends.json 에 수령 내역이 쌓이면 여기에 집계됩니다." />
      </div>
    );
  }

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

      {summary.byYear.map((year) => (
        <Section key={year.year} title={`${year.year}년`} description={`합계 ${money(year.totalKrw)}`}>
          <Card>
            <MonthlyBars months={monthsOfYear(summary, year.year)} />
          </Card>
        </Section>
      ))}

      <Section title="종목별 누적" description="지급 이력이 있는 종목만 표시합니다.">
        <Card>
          <ul className="space-y-3.5">
            {summary.bySymbol.map((line) => {
              const weight = summary.totalKrw > 0 ? (line.totalKrw / summary.totalKrw) * 100 : 0;
              return (
                <li key={line.symbolId}>
                  <div className="mb-1.5 flex items-baseline justify-between gap-3 text-[13px]">
                    <Link href={`/symbols/${encodeURIComponent(line.symbolId)}`} className="flex min-w-0 items-baseline gap-2 hover:text-accent">
                      <span className="font-bold tracking-tight">{line.symbolId}</span>
                      <span className="truncate text-[11px] text-faint">{line.name}</span>
                    </Link>
                    <span className="tnum shrink-0 font-semibold">
                      {money(line.totalKrw)}
                      <span className="ml-2 text-[11px] font-normal text-muted">
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
