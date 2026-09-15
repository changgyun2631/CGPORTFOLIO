import type { Metadata } from "next";

import { HoldingsTable } from "@/components/dashboard/holdings-table";
import { Card, PageTitle, Section } from "@/components/ui/primitives";
import { loadPortfolio } from "@/lib/data/views";
import { money, percent } from "@/lib/format";

export const metadata: Metadata = { title: "종목" };

export default async function SymbolsPage() {
  const { holdings, totals } = await loadPortfolio();

  const invested = holdings.filter((h) => h.kind !== "cash");
  const us = invested.filter((h) => h.market === "US");
  const kr = invested.filter((h) => h.market === "KR");
  const sumOf = (list: typeof invested) => list.reduce((sum, h) => sum + h.valueKrw, 0);

  return (
    <div className="space-y-8">
      <PageTitle title="종목" description="보유 중인 종목 전체입니다. 행을 누르면 상세로 이동합니다." />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Card>
          <p className="text-[11px] text-muted">미국 상장</p>
          <p className="tnum mt-1.5 text-[21px] font-bold">{money(sumOf(us))}</p>
          <p className="tnum mt-0.5 text-[11px] text-faint">
            {us.length}종목 · {percent(totals.totalKrw > 0 ? (sumOf(us) / totals.totalKrw) * 100 : 0, 1)}
          </p>
        </Card>
        <Card>
          <p className="text-[11px] text-muted">국내 상장</p>
          <p className="tnum mt-1.5 text-[21px] font-bold">{money(sumOf(kr))}</p>
          <p className="tnum mt-0.5 text-[11px] text-faint">
            {kr.length}종목 · {percent(totals.totalKrw > 0 ? (sumOf(kr) / totals.totalKrw) * 100 : 0, 1)}
          </p>
        </Card>
        <Card>
          <p className="text-[11px] text-muted">예수금</p>
          <p className="tnum mt-1.5 text-[21px] font-bold">{money(totals.totalKrw - sumOf(invested))}</p>
          <p className="tnum mt-0.5 text-[11px] text-faint">
            {percent(totals.totalKrw > 0 ? ((totals.totalKrw - sumOf(invested)) / totals.totalKrw) * 100 : 0, 1)}
          </p>
        </Card>
      </div>

      <Section title="보유 종목" description="평가금액이 큰 순서입니다.">
        <HoldingsTable holdings={holdings} />
      </Section>
    </div>
  );
}
