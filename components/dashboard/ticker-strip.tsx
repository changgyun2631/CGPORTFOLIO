import Link from "next/link";

import { Sparkline } from "@/components/charts/sparkline";
import type { Holding } from "@/lib/domain/portfolio";
import { moneySigned, percentSigned, price, trendOf } from "@/lib/format";

/**
 * 상단 티커 스트립. 같은 목록을 두 벌 이어 붙여 원본처럼 끊김 없이 흐른다.
 * 마우스를 올리면 멈추고, 모션 감소 설정에서는 자동 이동 대신 가로 스크롤을 쓴다.
 */
export function TickerStrip({ holdings, sparklines }: { holdings: Holding[]; sparklines: Record<string, number[]> }) {
  const renderHolding = (holding: Holding, duplicate: boolean) => {
    const trend = trendOf(holding.dayChangePercent);
    const tone = trend === "up" ? "text-up" : trend === "down" ? "text-down" : "text-flat";
    const values = sparklines[holding.symbolId] ?? [];

    return (
      <Link
        key={`${duplicate ? "duplicate" : "primary"}-${holding.symbolId}`}
        href={`/symbols/${encodeURIComponent(holding.symbolId)}`}
        tabIndex={duplicate ? -1 : undefined}
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
            {holding.kind === "cash" ? price(holding.shares, holding.currency) : price(holding.price, holding.currency)}
          </p>
          <p className={`tnum text-[11px] font-medium ${tone}`}>
            {holding.kind === "cash" ? moneySigned(holding.dayChangeKrw) : percentSigned(holding.dayChangePercent)}
          </p>
        </div>
        {values.length > 1 ? <Sparkline values={values} width={64} height={34} /> : null}
      </Link>
    );
  };

  return (
    <div className="ticker-marquee -mx-4 overflow-hidden pb-1 sm:-mx-6 lg:-mx-8">
      <div className="ticker-marquee-track flex w-max">
        <div className="ticker-marquee-copy flex shrink-0 gap-2.5 pl-4 pr-2.5 sm:pl-6 lg:pl-8">
          {holdings.map((holding) => renderHolding(holding, false))}
        </div>
        <div aria-hidden="true" className="ticker-marquee-copy flex shrink-0 gap-2.5 pl-4 pr-2.5 sm:pl-6 lg:pl-8">
          {holdings.map((holding) => renderHolding(holding, true))}
        </div>
      </div>
    </div>
  );
}
