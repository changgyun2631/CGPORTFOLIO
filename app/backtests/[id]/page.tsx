import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ValueChart } from "@/components/charts/value-chart";
import { Card, PageTitle, Section, Stat, WeightBar } from "@/components/ui/primitives";
import { loadBacktest, loadBacktests, loadPortfolio } from "@/lib/data/views";
import { analyzeSeries } from "@/lib/domain/metrics";
import { money, percent, percentSigned, shortDateTime } from "@/lib/format";

export const dynamic = "force-dynamic";

export async function generateStaticParams() {
  const results = await loadBacktests();
  return results.map((result) => ({ id: result.config.id }));
}

export async function generateMetadata({ params }: PageProps<"/backtests/[id]">): Promise<Metadata> {
  const { id } = await params;
  const result = await loadBacktest(id);
  return result ? { title: result.config.title, description: result.config.summary } : { title: "백테스트" };
}

export default async function BacktestDetailPage({ params }: PageProps<"/backtests/[id]">) {
  const { id } = await params;
  const [result, portfolio] = await Promise.all([loadBacktest(id), loadPortfolio()]);
  if (!result) notFound();

  const symbolName = new Map(portfolio.symbols.map((s) => [s.id, s.name]));
  const stats = analyzeSeries(result.series);
  const config = result.config;
  const hasWithdrawal = (config.monthlyWithdrawalKrw ?? 0) > 0;
  const hasContribution = (config.monthlyContributionKrw ?? 0) > 0;
  const weightSum = config.allocations.reduce((sum, a) => sum + a.weight, 0);

  if (result.series.length === 0) {
    return (
      <div className="space-y-6">
        <Link href="/backtests" className="text-xs text-accent hover:underline">
          ← 백테스트 목록
        </Link>
        <PageTitle title={config.title} description="가격 이력이 없어 계산하지 못했습니다." />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <Link href="/backtests" className="inline-block text-xs text-accent hover:underline">
        ← 백테스트 목록
      </Link>

      <PageTitle title={config.title} description={config.summary} />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="최종 평가금액"
          value={money(result.finalKrw)}
          sub={`${result.startDate} ~ ${result.endDate} · ${result.years.toFixed(1)}년`}
        />
        <Stat
          label="순증"
          value={money(result.netGainKrw)}
          tone={result.netGainKrw >= 0 ? "up" : "down"}
          sub={
            result.dividendContributionKrw === null
              ? `투입 ${money(result.investedKrw)} · 배당 미반영`
              : `투입 ${money(result.investedKrw)} · 이 중 배당 ${money(result.dividendContributionKrw)}`
          }
        />
        <Stat label="최대 낙폭" value={percent(stats.maxDrawdown)} tone="down" sub={stats.drawdownFrom && stats.drawdownTo ? `${shortDateTime(stats.drawdownFrom.at)} → ${shortDateTime(stats.drawdownTo.at)}` : undefined} />
        <Stat
          label={hasWithdrawal ? "누적 인출 (세후)" : result.cagrApplicable ? "연평균 성장률" : "투입 대비 순증률"}
          value={
            hasWithdrawal
              ? money(result.withdrawnKrw)
              : result.cagrApplicable
                ? percentSigned(result.cagr)
                : percentSigned(result.returnOnInvested)
          }
          sub={
            hasWithdrawal
              ? `세금 ${money(result.taxPaidKrw)} 차감 후 · 투입 대비 ${percentSigned(result.returnOnInvested)}`
              : result.cagrApplicable
                ? "초기 일시금 기준 연율"
                : "납입 시점이 제각각이라 연율 대신 순증률로 봅니다"
          }
        />
      </div>

      {result.depletedAt ? (
        <p className="rounded-xl border border-down bg-down-soft px-4 py-3 text-[13px] font-medium text-down">
          {result.depletedAt} 부터 목표 인출액을 채우지 못했습니다. 이 시나리오는 해당 구간에서 지속 가능하지 않습니다.
        </p>
      ) : null}

      <Section title="평가금액 추이" description="구간을 바꾸면 아래 지표도 그 구간 기준으로 다시 계산됩니다.">
        <Card>
          <ValueChart snapshots={result.series} showFx={false} />
        </Card>
      </Section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Section title="시나리오 설정">
          <Card>
            <dl className="space-y-3 text-[13px]">
              <Row label="초기 투입" value={money(config.initialKrw)} />
              {hasContribution ? <Row label="매달 추가 납입" value={money(config.monthlyContributionKrw!)} /> : null}
              {hasWithdrawal ? <Row label="매달 인출 (목표 실수령)" value={money(config.monthlyWithdrawalKrw!)} /> : null}
              {hasWithdrawal ? <Row label="인출 세율" value={percent((config.withdrawalTaxRate ?? 0) * 100, 0)} /> : null}
              <Row
                label="리밸런싱"
                value={
                  config.rebalance === "monthly"
                    ? "매달"
                    : config.rebalance === "quarterly"
                      ? "분기"
                      : config.rebalance === "yearly"
                        ? "연 1회"
                        : "없음"
                }
              />
              <Row label="매매 수수료" value={`${((config.feeRate ?? 0.00015) * 100).toFixed(3)}%`} />
            </dl>

            {result.skipped.length > 0 ? (
              <p className="mt-4 border-t border-line pt-3 text-[11px] text-faint">
                가격 이력이 없어 제외한 종목: {result.skipped.join(", ")} · 남은 종목으로 비중을 다시 정규화했습니다.
              </p>
            ) : null}
          </Card>
        </Section>

        <Section title="구성">
          <Card>
            <ul className="space-y-3.5">
              {config.allocations.map((allocation) => {
                const share = weightSum > 0 ? (allocation.weight / weightSum) * 100 : 0;
                return (
                  <li key={allocation.symbolId}>
                    <div className="mb-1.5 flex items-baseline justify-between gap-2 text-[13px]">
                      <Link
                        href={`/symbols/${encodeURIComponent(allocation.symbolId)}`}
                        className="flex min-w-0 items-baseline gap-2 hover:text-accent"
                      >
                        <span className="font-bold tracking-tight">{allocation.symbolId}</span>
                        <span className="truncate text-[11px] text-faint">{symbolName.get(allocation.symbolId) ?? ""}</span>
                      </Link>
                      <span className="tnum shrink-0 font-semibold">{percent(share, 1)}</span>
                    </div>
                    <WeightBar weight={share} />
                  </li>
                );
              })}
            </ul>
          </Card>
        </Section>
      </div>

      {/*
        차트 안의 지표는 사용자가 고른 기간 기준이고, 여기는 항상 전체 기간 기준이다.
        같은 이름의 지표가 다른 값으로 두 번 나오면 오해하므로 제목에서 구분한다.
      */}
      <Section title="전체 기간 통계" description="차트 아래 지표는 선택한 기간 기준입니다. 이 표는 백테스트 전체 구간을 봅니다.">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="최고점" value={money(stats.peak?.totalKrw)} sub={stats.peak ? shortDateTime(stats.peak.at) : undefined} />
          <Stat label="최저점" value={money(stats.trough?.totalKrw)} sub={stats.trough ? shortDateTime(stats.trough.at) : undefined} />
          <Stat label="현재/최고" value={percent(stats.vsPeakPercent)} sub={`최고 대비 ${money(stats.vsPeakAmount)}`} />
          <Stat
            label="낙폭 금액"
            value={money(stats.drawdownAmount)}
            tone="down"
            sub="최대 낙폭 구간에서 줄어든 평가금액"
          />
        </div>
      </Section>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-line pb-3 last:border-0 last:pb-0">
      <dt className="text-muted">{label}</dt>
      <dd className="tnum font-semibold">{value}</dd>
    </div>
  );
}
