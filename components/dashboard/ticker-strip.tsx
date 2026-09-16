import Link from "next/link";

import type { Holding } from "@/lib/domain/portfolio";
import { moneySigned, percentSigned, price, trendOf } from "@/lib/format";

/**
 * 상단 티커 스트립. 같은 목록을 두 벌 이어 붙여 원본처럼 끊김 없이 흐른다.
 * 마우스를 올리면 멈추고, 모션 감소 설정에서는 자동 이동 대신 가로 스크롤을 쓴다.
 * 카드 한 장에 심볼+종목명을 한 줄로, 가격·등락률을 아래 한 줄로 붙여 보여준다
 * (사용자가 참고 이미지로 준 형식).
 */
export function TickerStrip({ holdings }: { holdings: Holding[] }) {
  const renderHolding = (holding: Holding, duplicate: boolean) => {
    const trend = trendOf(holding.dayChangePercent);
    const tone = trend === "up" ? "text-up" : trend === "down" ? "text-down" : "text-flat";

    return (
      <Link
        key={`${duplicate ? "duplicate" : "primary"}-${holding.symbolId}`}
        href={`/symbols/${encodeURIComponent(holding.symbolId)}`}
        tabIndex={duplicate ? -1 : undefined}
        className="flex w-[200px] shrink-0 flex-col gap-1 rounded-2xl border border-line bg-surface px-3.5 py-3 transition-colors hover:border-line-strong hover:bg-surface-hover"
      >
        <p className="truncate text-[12px] leading-4">
          <span className="font-bold tracking-tight">{holding.symbolId}</span>
          <span className="ml-1.5 text-faint">{holding.name}</span>
        </p>
        <div className="flex items-baseline justify-between gap-2">
          <span className="tnum text-[15px] font-bold leading-tight">
            {holding.kind === "cash" ? price(holding.shares, holding.currency) : price(holding.price, holding.currency)}
          </span>
          <span className={`tnum text-[11px] font-medium ${tone}`}>
            {holding.kind === "cash" ? moneySigned(holding.dayChangeKrw) : percentSigned(holding.dayChangePercent)}
          </span>
        </div>
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
