export type ChartTrade = {
  at: string;
  side: "buy" | "sell";
  symbolId: string;
  shares: number;
  /** 체결 단가, 심볼 통화 기준 */
  price: number;
  /** 매도 시점 실현손익, 원화 환산(매수는 항상 0) */
  realizedKrw: number;
};

export type TradeMarkerGroup = {
  /** `snapshotTimes` 배열에서 이 그룹이 배정된 인덱스 */
  snapshotIndex: number;
  buy: number;
  sell: number;
  symbols: string[];
  side: "buy" | "sell" | "both";
  /** 이 그룹에 묶인 매수 거래들의 수량 합·가중평균 단가(심볼 통화). 매수가 없으면 0. */
  buyShares: number;
  buyAvgPrice: number;
  /** 이 그룹에 묶인 매도 거래들의 수량 합·가중평균 단가(심볼 통화)·실현손익 합(원화). 매도가 없으면 0. */
  sellShares: number;
  sellAvgPrice: number;
  sellRealizedKrw: number;
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
 * - 가중평균 단가·실현손익은 한 그룹에 서로 다른 종목이 섞여도 계산 자체는
 *   되지만(호출한 쪽이 알아서 판단), 여러 종목을 그냥 더한 "평단"은
 *   PriceHistory처럼 그룹이 항상 같은 종목일 때만 의미가 있다.
 */
export function groupTradeMarkers(snapshotTimes: string[], trades: ChartTrade[]): TradeMarkerGroup[] {
  if (snapshotTimes.length === 0 || trades.length === 0) return [];

  const parsedTimes = snapshotTimes.map((at) => Date.parse(at));
  const firstMs = parsedTimes[0];
  const lastMs = parsedTimes[parsedTimes.length - 1];

  type Accumulator = {
    buyCount: number;
    sellCount: number;
    symbols: Set<string>;
    buyShares: number;
    buyCost: number;
    sellShares: number;
    sellProceeds: number;
    sellRealizedKrw: number;
  };
  const grouped = new Map<number, Accumulator>();

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

    const marker: Accumulator = grouped.get(closestIndex) ?? {
      buyCount: 0,
      sellCount: 0,
      symbols: new Set<string>(),
      buyShares: 0,
      buyCost: 0,
      sellShares: 0,
      sellProceeds: 0,
      sellRealizedKrw: 0,
    };
    if (trade.side === "buy") {
      marker.buyCount += 1;
      marker.buyShares += trade.shares;
      marker.buyCost += trade.shares * trade.price;
    } else {
      marker.sellCount += 1;
      marker.sellShares += trade.shares;
      marker.sellProceeds += trade.shares * trade.price;
      marker.sellRealizedKrw += trade.realizedKrw;
    }
    marker.symbols.add(trade.symbolId);
    grouped.set(closestIndex, marker);
  }

  return [...grouped.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([snapshotIndex, marker]) => ({
      snapshotIndex,
      buy: marker.buyCount,
      sell: marker.sellCount,
      symbols: [...marker.symbols],
      side: marker.buyCount > 0 && marker.sellCount > 0 ? ("both" as const) : marker.buyCount > 0 ? ("buy" as const) : ("sell" as const),
      buyShares: marker.buyShares,
      buyAvgPrice: marker.buyShares > 0 ? marker.buyCost / marker.buyShares : 0,
      sellShares: marker.sellShares,
      sellAvgPrice: marker.sellShares > 0 ? marker.sellProceeds / marker.sellShares : 0,
      sellRealizedKrw: marker.sellRealizedKrw,
    }));
}
