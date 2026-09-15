import type { Holding } from "./portfolio";
import type { LookthroughTable, Symbol } from "./types";

/**
 * 자산맵의 재료.
 *
 * ETF를 그대로 두면 "QLD 49%"밖에 안 보인다. 구성종목까지 펼쳐서 합치면
 * 서로 다른 ETF에 겹쳐 담긴 종목이 드러나고, 실제로 내 돈이 어느 기업에
 * 얼마나 걸려 있는지가 보인다.
 */

export type LookthroughNode = {
  ticker: string;
  name: string;
  valueKrw: number;
  weight: number;
  sector?: string;
  /** 이 금액이 어느 보유 종목에서 흘러왔는지 */
  sources: { symbolId: string; valueKrw: number }[];
  /** 구성종목 단계의 전일 등락률(%) — 모체 ETF 등락률을 금액 가중 평균한 값 */
  dayChangePercent: number;
};

export type LookthroughResult = {
  nodes: LookthroughNode[];
  /** 펼치지 못하고 그대로 둔 보유 종목 수 */
  unresolved: number;
  totalKrw: number;
};

export function expandHoldings(holdings: Holding[], symbols: Symbol[], table: LookthroughTable): LookthroughResult {
  const symbolById = new Map(symbols.map((s) => [s.id, s]));
  const accumulator = new Map<string, LookthroughNode>();
  let unresolved = 0;

  const push = (
    ticker: string,
    name: string,
    valueKrw: number,
    sourceSymbolId: string,
    dayChangePercent: number,
    sector?: string,
  ) => {
    if (valueKrw <= 0) return;
    const node =
      accumulator.get(ticker) ??
      ({ ticker, name, valueKrw: 0, weight: 0, sector, sources: [], dayChangePercent: 0 } satisfies LookthroughNode);
    // 등락률은 합치기 전에 금액 가중으로 누적해 두고 마지막에 나눈다.
    node.dayChangePercent = node.dayChangePercent * node.valueKrw + dayChangePercent * valueKrw;
    node.valueKrw += valueKrw;
    node.dayChangePercent = node.valueKrw > 0 ? node.dayChangePercent / node.valueKrw : 0;
    node.sources.push({ symbolId: sourceSymbolId, valueKrw });
    node.sector ??= sector;
    accumulator.set(ticker, node);
  };

  for (const holding of holdings) {
    const symbol = symbolById.get(holding.symbolId);
    const lines = symbol?.lookthroughId ? table[symbol.lookthroughId] : undefined;

    if (!lines || lines.length === 0) {
      // 펼칠 표가 없으면 그 종목 자체를 한 칸으로 둔다. 예수금이 여기로 온다.
      if (symbol && symbol.kind !== "cash") unresolved += 1;
      push(holding.symbolId, holding.name, holding.valueKrw, holding.symbolId, holding.dayChangePercent);
      continue;
    }

    // 공시 비중 합이 100이 아닐 수 있으므로 실제 합으로 정규화한다.
    const weightSum = lines.reduce((sum, line) => sum + line.weight, 0);
    if (weightSum <= 0) {
      push(holding.symbolId, holding.name, holding.valueKrw, holding.symbolId, holding.dayChangePercent);
      continue;
    }

    for (const line of lines) {
      const share = (line.weight / weightSum) * holding.valueKrw;
      push(line.ticker, line.name, share, holding.symbolId, holding.dayChangePercent, line.sector);
    }
  }

  const totalKrw = [...accumulator.values()].reduce((sum, node) => sum + node.valueKrw, 0);
  const nodes = [...accumulator.values()]
    .map((node) => ({ ...node, weight: totalKrw > 0 ? (node.valueKrw / totalKrw) * 100 : 0 }))
    .sort((a, b) => b.valueKrw - a.valueKrw);

  return { nodes, unresolved, totalKrw };
}

/** 섹터별 집계. 자산맵 옆에 붙이는 요약. */
export function groupBySector(nodes: LookthroughNode[]) {
  const totals = new Map<string, { sector: string; valueKrw: number; count: number }>();
  for (const node of nodes) {
    const sector = node.sector ?? "미분류";
    const current = totals.get(sector) ?? { sector, valueKrw: 0, count: 0 };
    current.valueKrw += node.valueKrw;
    current.count += 1;
    totals.set(sector, current);
  }
  const grand = [...totals.values()].reduce((sum, t) => sum + t.valueKrw, 0);
  return [...totals.values()]
    .map((t) => ({ ...t, weight: grand > 0 ? (t.valueKrw / grand) * 100 : 0 }))
    .sort((a, b) => b.valueKrw - a.valueKrw);
}
