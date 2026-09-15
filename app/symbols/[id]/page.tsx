import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { PriceHistory } from "@/components/charts/price-history";
import { Card, Delta, Empty, PageTitle, Section, Stat, WeightBar } from "@/components/ui/primitives";
import { loadSymbolDetail } from "@/lib/data/views";
import { money, percent, price, shares as fmtShares, shortDateTime } from "@/lib/format";

export async function generateMetadata({ params }: PageProps<"/symbols/[id]">): Promise<Metadata> {
  const { id } = await params;
  const detail = await loadSymbolDetail(decodeURIComponent(id));
  return { title: detail ? `${detail.symbol.id} · ${detail.symbol.name}` : "종목" };
}

export default async function SymbolDetailPage({ params }: PageProps<"/symbols/[id]">) {
  const { id } = await params;
  const detail = await loadSymbolDetail(decodeURIComponent(id));
  if (!detail) notFound();

  const { symbol, holding, history, trades, payments, constituents, positions, fx } = detail;
  const isCash = symbol.kind === "cash";

  const dividendTotal = payments.reduce((sum, p) => sum + (p.currency === "USD" ? p.amount * fx.rate : p.amount), 0);

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <PageTitle title={symbol.id} description={symbol.name} />
        <div className="mb-6 flex items-center gap-2 text-[11px]">
          <span className="rounded border border-line px-1.5 py-0.5 text-faint">
            {symbol.market === "US" ? "미국 상장" : symbol.market === "KR" ? "국내 상장" : "예수금"}
          </span>
          <span className="rounded border border-line px-1.5 py-0.5 text-faint">{symbol.currency}</span>
          {symbol.kind === "etf" ? <span className="rounded border border-line px-1.5 py-0.5 text-faint">ETF</span> : null}
        </div>
      </div>

      {holding ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat
            label="현재가"
            value={isCash ? price(holding.shares, holding.currency) : price(holding.price, holding.currency)}
            delta={isCash ? undefined : <Delta percent={holding.dayChangePercent} showAmount={false} />}
            sub={isCash ? "예수금 잔액" : `전일 ${price(holding.prevClose, holding.currency)}`}
          />
          <Stat label="평가금액" value={money(holding.valueKrw)} sub={`비중 ${percent(holding.weight)}`} />
          <Stat
            label="평균 매수가"
            value={isCash ? "—" : price(holding.averagePrice, holding.currency)}
            sub={isCash ? undefined : `${fmtShares(holding.shares)}주 · 매입 ${money(holding.costKrw)}`}
          />
          <Stat
            label="누적 손익"
            value={isCash ? "—" : money(holding.totalGainKrw)}
            tone={holding.totalGainKrw >= 0 ? "up" : "down"}
            delta={isCash ? undefined : <Delta percent={holding.totalGainPercent} showAmount={false} />}
            sub={`전일 ${money(holding.dayChangeKrw)}`}
          />
        </div>
      ) : (
        <Empty title="보유하지 않은 종목입니다" description="거래 내역이 없어 평가 정보를 만들 수 없습니다." />
      )}

      {history.length > 1 ? (
        <Section title="가격 추이" description={`${history.length}거래일`}>
          <Card>
            <PriceHistory points={history} currency={symbol.currency} />
          </Card>
        </Section>
      ) : null}

      {positions.length > 0 ? (
        <Section title="계좌별 보유">
          <Card padded={false}>
            <ul className="divide-y divide-line">
              {positions.map((position) => (
                <li key={`${position.accountId}`} className="flex items-center gap-3 px-4 py-3 text-[13px]">
                  <span className="min-w-0 flex-1 font-medium">{position.accountName}</span>
                  <span className="tnum text-muted">{fmtShares(position.shares)}주</span>
                  <span className="tnum w-[100px] text-right text-muted">{price(position.averagePrice, symbol.currency)}</span>
                  <span className="tnum w-[120px] text-right font-semibold">
                    {money(position.shares * (holding?.price ?? position.averagePrice) * (symbol.currency === "USD" ? fx.rate : 1))}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        </Section>
      ) : null}

      {constituents.length > 0 ? (
        <Section
          title="구성종목"
          description={`발행사 공시 기준 상위 ${constituents.length}종목입니다.`}
          action={
            <Link href="/asset-map" className="text-xs text-accent hover:underline">
              자산맵에서 보기
            </Link>
          }
        >
          <Card>
            <ul className="grid grid-cols-1 gap-x-8 gap-y-2.5 sm:grid-cols-2">
              {constituents.map((line) => (
                <li key={line.ticker}>
                  <div className="mb-1 flex items-baseline justify-between gap-2 text-[12px]">
                    <span className="flex min-w-0 items-baseline gap-1.5">
                      <span className="font-bold tracking-tight">{line.ticker}</span>
                      <span className="truncate text-faint">{line.name}</span>
                    </span>
                    <span className="tnum shrink-0 font-semibold">{percent(line.weight, 1)}</span>
                  </div>
                  <WeightBar weight={(line.weight / constituents[0].weight) * 100} />
                </li>
              ))}
            </ul>
          </Card>
        </Section>
      ) : null}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Section title="매매 내역" description={`${trades.length}건`}>
          {trades.length > 0 ? (
            <Card padded={false}>
              <ul className="max-h-[420px] divide-y divide-line overflow-y-auto">
                {trades.map((tx) => (
                  <li key={tx.id} className="flex items-center gap-3 px-4 py-2.5 text-[12px]">
                    <span
                      className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold ${
                        tx.side === "buy" ? "bg-up-soft text-up" : "bg-down-soft text-down"
                      }`}
                    >
                      {tx.side === "buy" ? "매수" : "매도"}
                    </span>
                    <span className="tnum shrink-0 text-faint">{shortDateTime(tx.at)}</span>
                    <span className="min-w-0 flex-1 truncate text-muted">{tx.accountName}</span>
                    <span className="tnum shrink-0 text-muted">{fmtShares(tx.shares)}주</span>
                    <span className="tnum w-[90px] shrink-0 text-right font-semibold">{price(tx.price, symbol.currency)}</span>
                  </li>
                ))}
              </ul>
            </Card>
          ) : (
            <Empty title="매매 내역이 없습니다" />
          )}
        </Section>

        <Section title="배당 내역" description={payments.length > 0 ? `${payments.length}건 · 누적 ${money(dividendTotal)}` : undefined}>
          {payments.length > 0 ? (
            <Card padded={false}>
              <ul className="max-h-[420px] divide-y divide-line overflow-y-auto">
                {payments.map((payment) => (
                  <li key={payment.id} className="flex items-center gap-3 px-4 py-2.5 text-[12px]">
                    <span className="tnum shrink-0 text-faint">{payment.at.slice(0, 10)}</span>
                    <span className="min-w-0 flex-1 truncate text-muted">{payment.accountName}</span>
                    <span className="tnum shrink-0 font-semibold text-up">{money(payment.amount, payment.currency)}</span>
                  </li>
                ))}
              </ul>
            </Card>
          ) : (
            <Empty title="배당 기록이 없습니다" description="분배금을 지급하지 않았거나 아직 수령 전입니다." />
          )}
        </Section>
      </div>
    </div>
  );
}
