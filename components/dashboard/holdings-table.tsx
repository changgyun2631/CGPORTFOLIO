import Link from "next/link";

import { Delta } from "@/components/ui/primitives";
import type { Holding } from "@/lib/domain/portfolio";
import { money, percent, price, shares as fmtShares } from "@/lib/format";

/** 종목 랭킹. 평가금액 큰 순서로 세운다. */
export function HoldingsTable({ holdings, limit }: { holdings: Holding[]; limit?: number }) {
  const rows = limit ? holdings.slice(0, limit) : holdings;

  return (
    <div className="overflow-x-auto rounded-2xl border border-line">
      <table className="w-full min-w-[840px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-line bg-bg-elevated text-[11px] font-medium text-muted">
            <th scope="col" className="px-4 py-2.5 text-left">
              종목
            </th>
            <th scope="col" className="px-3 py-2.5 text-right">
              평균 매수가
            </th>
            <th scope="col" className="px-3 py-2.5 text-right">
              보유 수량
            </th>
            <th scope="col" className="px-3 py-2.5 text-right">
              비중
            </th>
            <th scope="col" className="px-3 py-2.5 text-right">
              평가금액
            </th>
            <th scope="col" className="px-3 py-2.5 text-right">
              전일 손익
            </th>
            <th scope="col" className="px-4 py-2.5 text-right">
              누적 수익
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((holding) => (
            <tr key={holding.symbolId} className="border-b border-line last:border-0 transition-colors hover:bg-surface-hover">
              <td className="px-4 py-3">
                <Link href={`/symbols/${encodeURIComponent(holding.symbolId)}`} className="group block">
                  <span className="text-[13px] font-bold tracking-tight group-hover:text-accent">{holding.symbolId}</span>
                  <span className="mt-0.5 block max-w-[220px] truncate text-[11px] text-faint">{holding.name}</span>
                </Link>
              </td>
              <td className="tnum px-3 py-3 text-right text-muted">
                {holding.kind === "cash" ? "—" : price(holding.averagePrice, holding.currency)}
              </td>
              <td className="tnum px-3 py-3 text-right text-muted">
                {holding.kind === "cash" ? "—" : fmtShares(holding.shares)}
              </td>
              <td className="tnum px-3 py-3 text-right font-medium">{percent(holding.weight)}</td>
              <td className="tnum px-3 py-3 text-right font-semibold">{money(holding.valueKrw)}</td>
              <td className="px-3 py-3 text-right">
                <Delta amount={holding.dayChangeKrw} percent={holding.kind === "cash" ? null : holding.dayChangePercent} />
              </td>
              <td className="px-4 py-3 text-right">
                {holding.kind === "cash" ? (
                  <span className="text-faint">—</span>
                ) : (
                  <Delta amount={holding.totalGainKrw} percent={holding.totalGainPercent} />
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
