export type ChartTrade = {
  at: string;
  side: "buy" | "sell";
  symbolId: string;
  shares: number;
};

export type TradeMarkerGroup = {
  /** `snapshotTimes` 배열에서 이 그룹이 배정된 인덱스 */
  snapshotIndex: number;
  buy: number;
  sell: number;
  symbols: string[];
  side: "buy" | "sell" | "both";
};

/**
 * 거래를 차트에 그려진 스냅샷 점 중 가장 가까운 것 하나에 묶는다.
 *
 * 스냅샷은 6시간(cron 주기)마다 한 점이라 거래 시각과 정확히 안 맞는 게 보통이다.
 * `ValueChart`의 렌더 본문에 섞여 있던 로직을 순수 함수로 뽑아서, 화면 좌표(x/y)
 * 없이 `at` 문자열 배열만으로 테스트할 수 있게 했다.
 *
 * - 구간(첫 점~마지막 점) 밖의 거래는 버린다.
 * - 동점 거리면 먼저 나온(배열에서 더 앞선) 스냅샷을 유지한다 — `<` 비교라
 *   나중 후보가 "더 가까울 때"만 바뀐다.
 * - 반환 순서는 스냅샷 인덱스 오름차순이다.
 */
export function groupTradeMarkers(snapshotTimes: string[], trades: ChartTrade[]): TradeMarkerGroup[] {
  if (snapshotTimes.length === 0 || trades.length === 0) return [];

  const parsedTimes = snapshotTimes.map((at) => Date.parse(at));
  const firstMs = parsedTimes[0];
  const lastMs = parsedTimes[parsedTimes.length - 1];

  const grouped = new Map<number, { buy: number; sell: number; symbols: Set<string> }>();

  for (const trade of trades) {
    const tradeMs = Date.parse(trade.at);
    if (!Number.isFinite(tradeMs) || tradeMs < firstMs || tradeMs > lastMs) continue;

    let closestIndex = 0;
    let closestDistance = Number.POSITIVE_INFINITY;
    parsedTimes.forEach((time, index) => {
      const distance = Math.abs(time - tradeMs);
      if (distance < closestDistance) {
        closestDistance = distance;
        closestIndex = index;
      }
    });

    const marker = grouped.get(closestIndex) ?? { buy: 0, sell: 0, symbols: new Set<string>() };
    marker[trade.side] += 1;
    marker.symbols.add(trade.symbolId);
    grouped.set(closestIndex, marker);
  }

  return [...grouped.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([snapshotIndex, marker]) => ({
      snapshotIndex,
      buy: marker.buy,
      sell: marker.sell,
      symbols: [...marker.symbols],
      side: marker.buy > 0 && marker.sell > 0 ? ("both" as const) : marker.buy > 0 ? ("buy" as const) : ("sell" as const),
    }));
}
