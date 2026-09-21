import type { Metadata } from "next";
import Link from "next/link";

import { colorFor } from "@/components/dashboard/palette";
import { Card, PageTitle, Section, WeightBar } from "@/components/ui/primitives";
import { loadAccountSummary, loadPortfolio } from "@/lib/data/views";
import { buildCashFlowLedger } from "@/lib/domain/portfolio";
import { dateLabel, daysHeldLabel, money, percent, shares as fmtShares, shortDateTime } from "@/lib/format";

export const metadata: Metadata = { title: "계좌" };
export const dynamic = "force-dynamic";

export default async function AccountsPage() {
  const [accounts, portfolio] = await Promise.all([loadAccountSummary(), loadPortfolio()]);
  const { cash, fx, accounts: rawAccounts, cashflows, fxRateAt } = portfolio;

  const krwCash = cash.filter((c) => c.currency === "KRW").reduce((sum, c) => sum + c.amount, 0);
  const usdCash = cash.filter((c) => c.currency === "USD").reduce((sum, c) => sum + c.amount, 0);

  // 입출금 전/후 잔액. 전체 이력을 시간순으로 누적한 뒤 최근 20건만 화면에 보여준다 —
  // 누적이라 일부만 잘라서 계산하면 중간부터 잔액이 어긋난다.
  const ledger = buildCashFlowLedger(rawAccounts, cashflows, fxRateAt);
  const accountName = new Map(rawAccounts.map((a) => [a.id, a.name]));
  const recentLedger = [...ledger].reverse().slice(0, 20);

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <PageTitle title="계좌" description="계좌별 평가금액과 예수금입니다. 세제가 다른 계좌를 나눠서 봅니다." />
        <Link
          href="/accounts/import"
          className="mb-6 shrink-0 rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:border-line-strong hover:text-text"
        >
          CSV 가져오기
        </Link>
      </div>

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

      {accounts.length > 1 ? (
        <Section title="계좌별 비중">
          <Card>
            <div className="flex h-3 w-full overflow-hidden rounded-full bg-bg-elevated">
              {accounts.map((account, index) => (
                <div
                  key={account.id}
                  className="h-full first:rounded-l-full last:rounded-r-full"
                  style={{ width: `${account.weight}%`, background: colorFor(index) }}
                  title={`${account.name} ${percent(account.weight)}`}
                />
              ))}
            </div>
            <ul className="mt-4 flex flex-wrap gap-x-4 gap-y-1.5 text-[11px]">
              {accounts.map((account, index) => (
                <li key={account.id} className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: colorFor(index) }} />
                  <span className="font-bold">{account.name}</span>
                  <span className="tnum text-muted">{percent(account.weight, 1)}</span>
                </li>
              ))}
            </ul>
          </Card>
        </Section>
      ) : null}

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
                      {/* 지금 물량을 들고 있기 시작한 날로부터 며칠인지. 전량 판 뒤 다시
                          샀으면 다시 산 날이 기준이다. 원장에 매수 기록이 없으면 "—". */}
                      <span
                        className="tnum w-[58px] shrink-0 text-right text-faint"
                        title={holding.heldSince ? `${dateLabel(holding.heldSince)}부터 보유` : "원장에 취득 기록이 없습니다"}
                      >
                        {holding.kind === "cash" ? "—" : daysHeldLabel(holding.heldSince)}
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

      <Section title="입출금 내역" description="최근 20건입니다. 잔액은 입출금만 반영한 값으로, 매매·배당은 포함하지 않습니다.">
        <div className="overflow-x-auto rounded-2xl border border-line">
          <table className="w-full min-w-[680px] border-collapse text-sm">
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
                <th scope="col" className="px-4 py-2.5 text-right">
                  전 잔액
                </th>
                <th scope="col" className="px-4 py-2.5 text-right">
                  후 잔액
                </th>
              </tr>
            </thead>
            <tbody>
              {recentLedger.map((cf) => (
                <tr key={cf.id} className="border-b border-line last:border-0 hover:bg-surface-hover">
                  <td className="tnum px-4 py-2.5 text-muted">{shortDateTime(cf.at)}</td>
                  <td className="px-3 py-2.5">{accountName.get(cf.accountId) ?? cf.accountId}</td>
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
                  <td className="tnum px-4 py-2.5 text-right text-faint">{money(cf.balanceBefore, cf.bucketCurrency)}</td>
                  <td className="tnum px-4 py-2.5 text-right font-semibold">{money(cf.balanceAfter, cf.bucketCurrency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  );
}
