import type { Metadata } from "next";
import Link from "next/link";

import { Sparkline } from "@/components/charts/sparkline";
import { Card, Delta, Empty, PageTitle } from "@/components/ui/primitives";
import { loadBacktests } from "@/lib/data/views";
import { analyzeSeries, downsample } from "@/lib/domain/metrics";
import { money, percent, percentSigned } from "@/lib/format";

export const metadata: Metadata = { title: "백테스트" };

export default async function BacktestsPage() {
  const results = await loadBacktests();

  if (results.length === 0 || results.every((r) => r.series.length === 0)) {
    return (
      <div className="space-y-8">
        <PageTitle title="백테스트" />
        <Empty title="돌릴 시나리오가 없습니다" description="data/backtests.json 에 시나리오를 추가하세요." />
      </div>
    );
  }

  const window = results.find((r) => r.series.length > 0);

  return (
    <div className="space-y-8">
      <PageTitle
        title="백테스트"
        description="보유 중인 종목의 실제 일별 종가와 환율로 돌린 결과입니다. 수익률 공식이 아니라 날마다 평가하고 정해진 날에 사고파는 방식으로 계산합니다."
      />

      {window ? (
        <p className="rounded-xl border border-line bg-bg-elevated px-4 py-3 text-xs leading-5 text-muted">
          계산 구간은 가격 이력이 있는 <span className="tnum font-semibold text-text">{window.startDate} ~ {window.endDate}</span>{" "}
          ({window.years.toFixed(1)}년)로 한정됩니다. 더 긴 구간을 보려면 <code className="rounded border border-line px-1">data/prices.json</code>{" "}
          에 과거 종가를 더 넣어야 합니다. 세금은 인출할 때 매도 차익에만 단일 세율로 매겼고, 계좌별 세제 차이와 리밸런싱
          과세는 반영하지 않았습니다.
        </p>
      ) : null}

      <ul className="space-y-3">
        {results.map((result) => {
          if (result.series.length === 0) {
            return (
              <li key={result.config.id}>
                <Card>
                  <h2 className="text-[15px] font-semibold">{result.config.title}</h2>
                  <p className="mt-1.5 text-[13px] text-muted">
                    가격 이력이 없어 계산하지 못했습니다{result.skipped.length > 0 ? ` (${result.skipped.join(", ")})` : ""}.
                  </p>
                </Card>
              </li>
            );
          }

          const stats = analyzeSeries(result.series);
          const spark = downsample(result.series, 48).map((s) => s.totalKrw);
          const hasWithdrawal = (result.config.monthlyWithdrawalKrw ?? 0) > 0;

          return (
            <li key={result.config.id}>
              <Link href={`/backtests/${result.config.id}`} className="block">
                <Card className="transition-colors hover:border-line-strong hover:bg-surface-hover">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <h2 className="text-[15px] font-semibold tracking-tight">{result.config.title}</h2>
                      <p className="mt-1.5 text-[13px] leading-6 text-muted">{result.config.summary}</p>
                    </div>
                    <Sparkline values={spark} width={132} height={44} />
                  </div>

                  <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-line pt-3 text-[12px] sm:grid-cols-4">
                    <div>
                      <dt className="text-faint">최종 평가</dt>
                      <dd className="tnum mt-0.5 font-bold">{money(result.finalKrw)}</dd>
                    </div>
                    <div>
                      <dt className="text-faint">순증</dt>
                      <dd className="mt-0.5 font-bold">
                        <Delta amount={result.netGainKrw} />
                      </dd>
                    </div>
                    <div>
                      <dt className="text-faint">MDD</dt>
                      <dd className="tnum mt-0.5 font-bold text-down">{percent(stats.maxDrawdown)}</dd>
                    </div>
                    <div>
                      <dt className="text-faint">
                        {hasWithdrawal ? "누적 인출" : result.cagrApplicable ? "연평균" : "투입 대비"}
                      </dt>
                      <dd className="tnum mt-0.5 font-bold">
                        {hasWithdrawal
                          ? money(result.withdrawnKrw)
                          : result.cagrApplicable
                            ? percentSigned(result.cagr)
                            : percentSigned(result.returnOnInvested)}
                      </dd>
                    </div>
                  </dl>

                  {result.depletedAt ? (
                    <p className="mt-3 rounded-lg bg-down-soft px-3 py-2 text-[11px] font-medium text-down">
                      {result.depletedAt} 에 목표 인출액을 채우지 못했습니다. 자금이 소진되는 구간입니다.
                    </p>
                  ) : null}
                </Card>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
