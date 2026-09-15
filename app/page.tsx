import Link from "next/link";

import { MonthlyBars } from "@/components/charts/monthly-bars";
import { Treemap, TreemapLegend } from "@/components/charts/treemap";
import { ValueChart } from "@/components/charts/value-chart";
import { AllocationBar } from "@/components/dashboard/allocation";
import { HoldingsTable } from "@/components/dashboard/holdings-table";
import { TickerStrip } from "@/components/dashboard/ticker-strip";
import { Card, Delta, Empty, PageTitle, Section, Stat, WeightBar } from "@/components/ui/primitives";
import {
  loadAccountSummary,
  loadAssetMap,
  loadDividendSummary,
  loadPortfolio,
  loadRecentCashFlows,
  loadRecentTrades,
  loadSparklines,
} from "@/lib/data/views";
import { monthsOfYear } from "@/lib/domain/dividends";
import { money, moneyBare, percent, price, shortDateTime } from "@/lib/format";

export default async function DashboardPage() {
  const [portfolio, sparklines, accounts, assetMap, dividends, trades, cashflows] = await Promise.all([
    loadPortfolio(),
    loadSparklines(),
    loadAccountSummary(),
    loadAssetMap(),
    loadDividendSummary(),
    loadRecentTrades(4),
    loadRecentCashFlows(3),
  ]);

  const { holdings, totals, fx, snapshots, realizedKrw, transactions } = portfolio;
  const chartTrades = transactions.map((tx) => ({ at: tx.at, side: tx.side }));
  const fxChange = fx.rate - fx.prevRate;
  const fxChangePercent = fx.prevRate > 0 ? (fxChange / fx.prevRate) * 100 : 0;

  const invested = holdings.filter((h) => h.kind !== "cash");
  const winners = invested.filter((h) => h.totalGainKrw > 0);
  const best = [...invested].sort((a, b) => b.totalGainPercent - a.totalGainPercent)[0];

  const currentYear = String(new Date().getFullYear());
  const dividendMonths = monthsOfYear(dividends, currentYear);

  return (
    <div className="space-y-10">
      <PageTitle
        title="대시보드"
        description={`보유 자산 ${totals.symbolCount}개 · ${totals.accountCount}개 계좌 · ${shortDateTime(fx.asOf)} 기준`}
      />

      <TickerStrip holdings={holdings} sparklines={sparklines} />

      <div className="grid grid-cols-1 gap-4">
        <Card>
          <p className="text-xs font-medium text-muted">총 평가금액</p>
          <p className="tnum mt-2 text-[34px] font-black leading-none tracking-tight sm:text-[42px]">
            {moneyBare(totals.totalKrw)}
            <span className="ml-1 text-lg font-bold text-muted">원</span>
          </p>
          <p className="mt-3 flex flex-wrap items-baseline gap-2 text-sm">
            <span className="text-xs text-muted">전일 대비</span>
            <Delta amount={totals.dayChangeKrw} percent={totals.dayChangePercent} className="text-[15px] font-bold" />
          </p>
          <dl className="mt-5 grid grid-cols-2 gap-3 border-t border-line pt-4 text-xs">
            <div>
              <dt className="text-faint">달러 환산</dt>
              <dd className="tnum mt-0.5 font-semibold">{money(totals.totalUsd, "USD")}</dd>
            </div>
            <div>
              <dt className="text-faint">실현 손익</dt>
              <dd className="mt-0.5 font-semibold">
                <Delta amount={realizedKrw} />
              </dd>
            </div>
          </dl>
        </Card>

        <Card>
          <div className="mb-4 flex items-baseline justify-between">
            <h2 className="text-[15px] font-semibold tracking-tight">자산 구성</h2>
            <Link href="/symbols" className="text-xs text-accent hover:underline">
              종목 전체
            </Link>
          </div>
          <AllocationBar holdings={holdings} />
        </Card>
      </div>

      <Section
        title="총 평가금액 및 환율 추이"
        description="점선은 원/달러 환율입니다. 기간을 바꾸면 아래 지표도 그 구간 기준으로 다시 계산됩니다."
      >
        <Card>
          <ValueChart snapshots={snapshots} principalKrw={totals.principalKrw} trades={chartTrades} />
        </Card>
      </Section>

      <Section title="핵심 지표" description="원금은 순입금액, 매입금은 현재 보유분의 원가입니다.">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat
            label="원금 대비 수익"
            value={moneyBare(totals.principalGainKrw)}
            tone={totals.principalGainKrw >= 0 ? "up" : "down"}
            delta={<Delta percent={totals.principalGainPercent} showAmount={false} />}
            sub={`원금 ${money(totals.principalKrw)}`}
          />
          <Stat
            label="매입 대비 수익"
            value={moneyBare(totals.gainKrw)}
            tone={totals.gainKrw >= 0 ? "up" : "down"}
            delta={<Delta percent={totals.gainPercent} showAmount={false} />}
            sub={`매입금 ${money(totals.costKrw)}`}
          />
          <Stat
            label="전일 평가손익"
            value={moneyBare(totals.dayChangeKrw)}
            tone={totals.dayChangeKrw >= 0 ? "up" : "down"}
            delta={<Delta percent={totals.dayChangePercent} showAmount={false} />}
            sub={`총 평가 ${money(totals.totalKrw)}`}
          />
          <Stat
            label="환율"
            value={fx.rate.toFixed(2)}
            delta={<Delta percent={fxChangePercent} showAmount={false} />}
            sub={`달러/원 · ${fxChange >= 0 ? "+" : ""}${fxChange.toFixed(2)}`}
          />
          <Stat
            label="연간 예상 배당"
            value={moneyBare(dividends.forecastKrw)}
            sub={`올해 수령 ${money(dividends.thisYearKrw)}${dividends.forecastIsEstimated ? " · 일부 추정치" : ""}`}
            href="/dividends"
          />
          <Stat
            label="수익 종목 비율"
            value={`${winners.length}/${invested.length}`}
            delta={
              <span className="text-muted">{percent(invested.length > 0 ? (winners.length / invested.length) * 100 : 0, 1)}</span>
            }
            sub={`손실 ${invested.length - winners.length}개 종목`}
          />
          <Stat
            label="최고 수익률"
            value={best ? best.symbolId : "—"}
            tone={best && best.totalGainKrw >= 0 ? "up" : "down"}
            delta={best ? <Delta amount={best.totalGainKrw} percent={best.totalGainPercent} /> : undefined}
            sub={best ? best.name : undefined}
            href={best ? `/symbols/${encodeURIComponent(best.symbolId)}` : undefined}
          />
          <Stat label="계좌 / 종목" value={`${totals.accountCount} / ${totals.symbolCount}`} sub="계좌별 구성은 계좌 화면에서" href="/accounts" />
        </div>
      </Section>

      <Section
        title={`월간 배당 · ${currentYear}년`}
        description={`합계 ${money(dividends.thisYearKrw)} · 연간 예상 ${money(dividends.forecastKrw)}`}
        action={
          <Link href="/dividends" className="text-xs text-accent hover:underline">
            배당 전체
          </Link>
        }
      >
        <Card>
          {dividends.byYear.length > 0 ? (
            <>
              <MonthlyBars months={dividendMonths} symbolOrder={dividends.bySymbol.map((line) => line.symbolId)} />
              <ul className="mt-4 flex flex-wrap gap-x-4 gap-y-1.5 border-t border-line pt-3 text-[11px]">
                {dividends.bySymbol.slice(0, 6).map((line) => (
                  <li key={line.symbolId} className="flex items-baseline gap-1.5">
                    <span className="font-bold tracking-tight">{line.symbolId}</span>
                    <span className="tnum text-muted">{money(line.totalKrw)}</span>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <Empty title="배당 기록이 없습니다" description="배당 내역이 쌓이면 월별로 집계됩니다." />
          )}
        </Card>
      </Section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Section title="최신 매매 내역">
          <Card padded={false}>
            <ul className="divide-y divide-line">
              {trades.map((tx) => (
                <li key={tx.id} className="flex items-center gap-3 px-4 py-3">
                  <span
                    className={`shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-bold ${
                      tx.side === "buy" ? "bg-up-soft text-up" : "bg-down-soft text-down"
                    }`}
                  >
                    {tx.side === "buy" ? "매수" : "매도"}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="flex items-baseline gap-1.5 text-[13px] font-semibold">
                      <span className="tracking-tight">{tx.symbolId}</span>
                      <span className="tnum text-[11px] font-medium text-muted">
                        {tx.side === "buy" ? "+" : "−"}
                        {tx.shares}주
                      </span>
                    </p>
                    <p className="truncate text-[11px] text-faint">
                      {tx.accountName} · {shortDateTime(tx.at)}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="tnum text-[12px] font-semibold">{price(tx.price, tx.currency as "KRW" | "USD")}</p>
                    <p className="tnum text-[11px] text-faint">{money(tx.amount, tx.currency as "KRW" | "USD")}</p>
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        </Section>

        <Section title="최신 입출금 내역">
          <Card padded={false}>
            <ul className="divide-y divide-line">
              {cashflows.map((cf) => (
                <li key={cf.id} className="flex items-center gap-3 px-4 py-3">
                  <span
                    className={`shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-bold ${
                      cf.type === "deposit" ? "bg-accent-soft text-accent" : "bg-surface-hover text-muted"
                    }`}
                  >
                    {cf.type === "deposit" ? "입금" : "출금"}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-semibold">{cf.accountName}</p>
                    <p className="text-[11px] text-faint">{shortDateTime(cf.at)}</p>
                  </div>
                  <p className={`tnum shrink-0 text-[13px] font-semibold ${cf.type === "deposit" ? "text-up" : "text-down"}`}>
                    {cf.type === "deposit" ? "+" : "−"}
                    {money(cf.amount, cf.currency)}
                  </p>
                </li>
              ))}
            </ul>
          </Card>
        </Section>
      </div>

      <Section
        title="자산맵"
        description={`보유 ETF의 구성종목까지 펼친 결과입니다. ${assetMap.nodes.length}개 종목`}
        action={
          <Link href="/asset-map" className="text-xs text-accent hover:underline">
            전체 화면
          </Link>
        }
      >
        <Card>
          <Treemap
            data={assetMap.nodes.slice(0, 60).map((node) => ({
              key: node.ticker,
              label: node.ticker,
              name: node.name,
              value: node.valueKrw,
              changePercent: node.dayChangePercent,
            }))}
            height={420}
          />
          <div className="mt-3 flex justify-end">
            <TreemapLegend />
          </div>
        </Card>
      </Section>

      <Section
        title="계좌별 평가금액"
        action={
          <Link href="/accounts" className="text-xs text-accent hover:underline">
            계좌 상세
          </Link>
        }
      >
        <Card>
          <ul className="space-y-3.5">
            {accounts
              .filter((account) => account.valueKrw > 0)
              .map((account) => (
                <li key={account.id}>
                  <div className="mb-1.5 flex items-baseline justify-between gap-3">
                    <span className="flex items-baseline gap-2">
                      <span className="text-[13px] font-semibold">{account.name}</span>
                      <span className="rounded border border-line px-1 text-[10px] text-faint">{account.kind}</span>
                    </span>
                    <span className="tnum text-[13px] font-semibold">
                      {money(account.valueKrw)}
                      <span className="ml-2 text-[11px] font-medium text-muted">{percent(account.weight, 1)}</span>
                    </span>
                  </div>
                  <WeightBar weight={account.weight} />
                </li>
              ))}
          </ul>
        </Card>
      </Section>

      <Section title="종목 랭킹" description="평가금액이 큰 순서입니다.">
        <HoldingsTable holdings={holdings} />
      </Section>
    </div>
  );
}
