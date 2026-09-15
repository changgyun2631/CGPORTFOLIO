import Link from "next/link";

import { Sparkline } from "@/components/charts/sparkline";
import type { Holding } from "@/lib/domain/portfolio";
import { moneySigned, percentSigned, price, trendOf } from "@/lib/format";

/**
 * 상단 티커 스트립. 보유 종목의 현재가와 전일 변동을 가로로 훑는다.
 * 좁은 화면에서는 가로 스크롤로 넘긴다.
 */
export function TickerStrip({ holdings, sparklines }: { holdings: Holding[]; sparklines: Record<string, number[]> }) {
  return (
    <div className="-mx-4 overflow-x-auto px-4 pb-1 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
      <div className="flex min-w-max gap-2.5">
        {holdings.map((holding) => {
          const trend = trendOf(holding.dayChangePercent);
          const tone = trend === "up" ? "text-up" : trend === "down" ? "text-down" : "text-flat";
          const values = sparklines[holding.symbolId] ?? [];

          return (
            <Link
              key={holding.symbolId}
              href={`/symbols/${encodeURIComponent(holding.symbolId)}`}
              className="flex w-[228px] shrink-0 items-center gap-3 rounded-2xl border border-line bg-surface px-3.5 py-3 transition-colors hover:border-line-strong hover:bg-surface-hover"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-1.5">
                  <span className="truncate text-[13px] font-bold tracking-tight">{holding.symbolId}</span>
                  {holding.market !== "CASH" ? (
                    <span className="shrink-0 rounded border border-line px-1 text-[9px] text-faint">
                      {holding.market === "US" ? "미국" : "국내"}
                    </span>
                  ) : null}
                </div>
                <p className="truncate text-[10px] leading-4 text-faint">{holding.name}</p>
                <p className="tnum mt-1 text-[15px] font-bold leading-tight">
                  {holding.kind === "cash"
                    ? price(holding.shares, holding.currency)
                    : price(holding.price, holding.currency)}
                </p>
                <p className={`tnum text-[11px] font-medium ${tone}`}>
                  {holding.kind === "cash"
                    ? moneySigned(holding.dayChangeKrw)
                    : `${percentSigned(holding.dayChangePercent)}`}
                </p>
              </div>
              {values.length > 1 ? <Sparkline values={values} width={64} height={34} /> : null}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
