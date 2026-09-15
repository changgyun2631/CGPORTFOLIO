import type { Metadata } from "next";
import Link from "next/link";

import { Card, PageTitle, Section, WeightBar } from "@/components/ui/primitives";
import { loadAccountSummary, loadPortfolio, loadRecentCashFlows } from "@/lib/data/views";
import { money, percent, shares as fmtShares, shortDateTime } from "@/lib/format";

export const metadata: Metadata = { title: "계좌" };

export default async function AccountsPage() {
  const [accounts, portfolio, cashflows] = await Promise.all([loadAccountSummary(), loadPortfolio(), loadRecentCashFlows(20)]);
  const { cash, fx } = portfolio;

  const krwCash = cash.filter((c) => c.currency === "KRW").reduce((sum, c) => sum + c.amount, 0);
  const usdCash = cash.filter((c) => c.currency === "USD").reduce((sum, c) => sum + c.amount, 0);

  return (
    <div className="space-y-8">
      <PageTitle title="계좌" description="계좌별 평가금액과 예수금입니다. 세제가 다른 계좌를 나눠서 봅니다." />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Card>
          <p className="text-[11px] text-muted">원화 예수금</p>
          <p className="tnum mt-1.5 text-[21px] font-bold">{money(krwCash)}</p>
        </Card>
        <Card>
          <p className="text-[11px] text-muted">달러 예수금</p>
          <p className="tnum mt-1.5 text-[21px] font-bold">{money(usdCash, "USD")}</p>
          <p className="tnum mt-0.5 text-[11px] text-faint">{money(usdCash * fx.rate)}</p>
        </Card>
        <Card>
          <p className="text-[11px] text-muted">적용 환율</p>
          <p className="tnum mt-1.5 text-[21px] font-bold">{fx.rate.toFixed(2)}</p>
          <p className="mt-0.5 text-[11px] text-faint">{shortDateTime(fx.asOf)} 기준</p>
        </Card>
      </div>

      <Section title="계좌별 구성">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {accounts.map((account) => (
            <Card key={account.id}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="flex items-baseline gap-2 text-[15px] font-semibold">
                    {account.name}
                    <span className="rounded border border-line px-1 text-[10px] font-normal text-faint">{account.kind}</span>
                  </h3>
                  <p className="mt-0.5 text-[11px] text-faint">
                    {account.broker ?? "증권사 미지정"} · {account.currency}
                  </p>
                </div>
                <div className="text-right">
                  <p className="tnum text-[17px] font-bold">{money(account.valueKrw)}</p>
                  <p className="tnum text-[11px] text-muted">{percent(account.weight, 1)}</p>
                </div>
              </div>

              <div className="mt-3">
                <WeightBar weight={account.weight} />
              </div>

              {account.holdings.length > 0 ? (
                <ul className="mt-4 space-y-2 border-t border-line pt-3">
                  {account.holdings.map((holding) => (
                    <li key={`${account.id}-${holding.symbolId}`} className="flex items-center gap-2 text-[12px]">
                      <Link
                        href={`/symbols/${encodeURIComponent(holding.symbolId)}`}
                        className="w-[64px] shrink-0 font-bold tracking-tight hover:text-accent"
                      >
                        {holding.symbolId}
                      </Link>
                      <span className="min-w-0 flex-1 truncate text-faint">{holding.name}</span>
                      <span className="tnum shrink-0 text-muted">
                        {holding.kind === "cash" ? "—" : `${fmtShares(holding.shares)}주`}
                      </span>
                      <span className="tnum w-[110px] shrink-0 text-right font-semibold">{money(holding.valueKrw)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-4 border-t border-line pt-3 text-[12px] text-faint">보유 종목이 없습니다.</p>
              )}
            </Card>
          ))}
        </div>
      </Section>

      <Section title="입출금 내역" description="최근 20건입니다.">
        <div className="overflow-x-auto rounded-2xl border border-line">
          <table className="w-full min-w-[520px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-line bg-bg-elevated text-[11px] font-medium text-muted">
                <th scope="col" className="px-4 py-2.5 text-left">
                  일시
                </th>
                <th scope="col" className="px-3 py-2.5 text-left">
                  계좌
                </th>
                <th scope="col" className="px-3 py-2.5 text-left">
                  구분
                </th>
                <th scope="col" className="px-4 py-2.5 text-right">
                  금액
                </th>
              </tr>
            </thead>
            <tbody>
              {cashflows.map((cf) => (
                <tr key={cf.id} className="border-b border-line last:border-0 hover:bg-surface-hover">
                  <td className="tnum px-4 py-2.5 text-muted">{shortDateTime(cf.at)}</td>
                  <td className="px-3 py-2.5">{cf.accountName}</td>
                  <td className="px-3 py-2.5">
                    <span
                      className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold ${
                        cf.type === "deposit" ? "bg-accent-soft text-accent" : "bg-surface-hover text-muted"
                      }`}
                    >
                      {cf.type === "deposit" ? "입금" : "출금"}
                    </span>
                  </td>
                  <td className={`tnum px-4 py-2.5 text-right font-semibold ${cf.type === "deposit" ? "text-up" : "text-down"}`}>
                    {cf.type === "deposit" ? "+" : "−"}
                    {money(cf.amount, cf.currency)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  );
}
