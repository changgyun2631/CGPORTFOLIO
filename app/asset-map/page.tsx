import type { Metadata } from "next";
import Link from "next/link";

import { Treemap, TreemapLegend } from "@/components/charts/treemap";
import { Card, Delta, PageTitle, Section, WeightBar } from "@/components/ui/primitives";
import { loadAssetMap, loadPortfolio } from "@/lib/data/views";
import { money, percent } from "@/lib/format";

export const metadata: Metadata = { title: "자산맵" };

export default async function AssetMapPage() {
  const [assetMap, portfolio] = await Promise.all([loadAssetMap(), loadPortfolio()]);
  const symbolNames = new Map(portfolio.symbols.map((s) => [s.id, s.name]));

  return (
    <div className="space-y-8">
      <PageTitle
        title="자산맵"
        description="보유 ETF를 구성종목까지 펼쳐서, 실제로 어느 기업에 얼마가 걸려 있는지 봅니다. 면적은 평가금액, 색은 전일 등락률입니다."
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">
          <span className="font-semibold text-text">{assetMap.nodes.length}개</span> 종목 · 합계{" "}
          <span className="tnum font-semibold text-text">{money(assetMap.totalKrw)}</span>
          {assetMap.unresolved > 0 ? (
            <span className="ml-2 text-faint">구성종목 표가 없는 {assetMap.unresolved}개는 펼치지 않았습니다.</span>
          ) : null}
        </p>
        <TreemapLegend />
      </div>

      <Card>
        <Treemap
          data={assetMap.nodes.map((node) => ({
            key: node.ticker,
            label: node.ticker,
            name: node.name,
            value: node.valueKrw,
            changePercent: node.dayChangePercent,
          }))}
          height={640}
        />
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Section title="구성종목 상위" description="여러 ETF에 겹쳐 담긴 종목은 합산됩니다.">
          <div className="overflow-x-auto rounded-2xl border border-line">
            <table className="w-full min-w-[620px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-line bg-bg-elevated text-[11px] font-medium text-muted">
                  <th scope="col" className="px-4 py-2.5 text-left">
                    종목
                  </th>
                  <th scope="col" className="px-3 py-2.5 text-right">
                    비중
                  </th>
                  <th scope="col" className="px-3 py-2.5 text-right">
                    평가금액
                  </th>
                  <th scope="col" className="px-3 py-2.5 text-right">
                    전일
                  </th>
                  <th scope="col" className="px-4 py-2.5 text-left">
                    담긴 경로
                  </th>
                </tr>
              </thead>
              <tbody>
                {assetMap.nodes.slice(0, 40).map((node) => (
                  <tr key={node.ticker} className="border-b border-line last:border-0 hover:bg-surface-hover">
                    <td className="px-4 py-2.5">
                      <span className="text-[13px] font-bold tracking-tight">{node.ticker}</span>
                      <span className="mt-0.5 block max-w-[200px] truncate text-[11px] text-faint">{node.name}</span>
                    </td>
                    <td className="tnum px-3 py-2.5 text-right font-medium">{percent(node.weight)}</td>
                    <td className="tnum px-3 py-2.5 text-right">{money(node.valueKrw)}</td>
                    <td className="px-3 py-2.5 text-right">
                      <Delta percent={node.dayChangePercent} showAmount={false} />
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="flex flex-wrap gap-1">
                        {node.sources
                          .slice()
                          .sort((a, b) => b.valueKrw - a.valueKrw)
                          .slice(0, 3)
                          .map((source) => (
                            <Link
                              key={source.symbolId}
                              href={`/symbols/${encodeURIComponent(source.symbolId)}`}
                              title={symbolNames.get(source.symbolId) ?? source.symbolId}
                              className="rounded border border-line px-1.5 py-0.5 text-[10px] text-muted hover:border-line-strong hover:text-text"
                            >
                              {source.symbolId}
                            </Link>
                          ))}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>

        <Section title="섹터 비중" description="구성종목의 섹터를 합산한 결과입니다.">
          <Card>
            <ul className="space-y-3.5">
              {assetMap.sectors.map((sector) => (
                <li key={sector.sector}>
                  <div className="mb-1.5 flex items-baseline justify-between gap-2 text-[13px]">
                    <span className="font-medium">
                      {sector.sector}
                      <span className="ml-1.5 text-[10px] text-faint">{sector.count}종목</span>
                    </span>
                    <span className="tnum font-semibold">
                      {percent(sector.weight, 1)}
                      <span className="ml-2 text-[11px] font-normal text-muted">{money(sector.valueKrw)}</span>
                    </span>
                  </div>
                  <WeightBar weight={sector.weight} />
                </li>
              ))}
            </ul>
          </Card>
        </Section>
      </div>
    </div>
  );
}
