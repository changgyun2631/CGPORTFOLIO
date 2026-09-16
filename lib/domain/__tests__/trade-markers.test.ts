import { describe, expect, it } from "vitest";

import { groupTradeMarkers, type ChartTrade } from "../trade-markers";

const times = ["2026-01-01T00:00:00Z", "2026-01-02T00:00:00Z", "2026-01-03T00:00:00Z"];

function trade(at: string, side: ChartTrade["side"], symbolId = "QLD", overrides: Partial<ChartTrade> = {}): ChartTrade {
  return { at, side, symbolId, shares: 1, price: 100, realizedKrw: 0, ...overrides };
}

describe("groupTradeMarkers", () => {
  it("점이나 거래가 없으면 빈 배열이다", () => {
    expect(groupTradeMarkers([], [trade("2026-01-01T00:00:00Z", "buy")])).toEqual([]);
    expect(groupTradeMarkers(times, [])).toEqual([]);
  });

  it("구간 밖(첫 점보다 이전) 거래는 제외한다", () => {
    const result = groupTradeMarkers(times, [trade("2025-12-31T00:00:00Z", "buy")]);
    expect(result).toEqual([]);
  });

  it("구간 밖(마지막 점보다 이후) 거래는 제외한다", () => {
    const result = groupTradeMarkers(times, [trade("2026-01-04T00:00:00Z", "sell")]);
    expect(result).toEqual([]);
  });

  it("거래 시각이 스냅샷과 정확히 같으면(일자 경계) 그 스냅샷에 배정한다", () => {
    const result = groupTradeMarkers(times, [trade("2026-01-02T00:00:00Z", "buy")]);
    expect(result).toEqual([
      {
        snapshotIndex: 1,
        buy: 1,
        sell: 0,
        symbols: ["QLD"],
        side: "buy",
        buyShares: 1,
        buyAvgPrice: 100,
        sellShares: 0,
        sellAvgPrice: 0,
        sellRealizedKrw: 0,
      },
    ]);
  });

  it("같은 날 매수·매도가 동시에 있으면 side가 both다", () => {
    const result = groupTradeMarkers(times, [
      trade("2026-01-02T01:00:00Z", "buy"),
      trade("2026-01-02T02:00:00Z", "sell"),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ snapshotIndex: 1, buy: 1, sell: 1, side: "both" });
  });

  it("동일 시각에 여러 종목이 거래되면 종목 집합과 건수를 정확히 집계한다", () => {
    const result = groupTradeMarkers(times, [
      trade("2026-01-01T12:00:00Z", "buy", "QLD"),
      trade("2026-01-01T12:00:00Z", "buy", "TQQQ"),
      trade("2026-01-01T12:00:00Z", "sell", "SCHD"),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].buy).toBe(2);
    expect(result[0].sell).toBe(1);
    expect(result[0].symbols.sort()).toEqual(["QLD", "SCHD", "TQQQ"]);
  });

  it("정확히 중간 지점이면 먼저 나온(더 앞선) 스냅샷을 유지한다", () => {
    // 01-01 00:00 ~ 01-02 00:00 정중앙인 01-01 12:00
    const result = groupTradeMarkers(times, [trade("2026-01-01T12:00:00Z", "buy")]);
    expect(result[0].snapshotIndex).toBe(0);
  });

  it("가장 가까운 스냅샷으로 정확히 배정한다(중간이 아닐 때)", () => {
    const result = groupTradeMarkers(times, [trade("2026-01-01T13:00:00Z", "buy")]);
    expect(result[0].snapshotIndex).toBe(1); // 01-02 00:00이 01-01 00:00보다 가깝다
  });

  it("여러 거래가 서로 다른 스냅샷에 배정되면 스냅샷 인덱스 오름차순으로 반환한다", () => {
    const result = groupTradeMarkers(times, [
      trade("2026-01-03T00:00:00Z", "sell"),
      trade("2026-01-01T00:00:00Z", "buy"),
    ]);
    expect(result.map((r) => r.snapshotIndex)).toEqual([0, 2]);
  });

  it("잘못된 날짜(파싱 불가)는 조용히 제외한다", () => {
    const result = groupTradeMarkers(times, [trade("not-a-date", "buy")]);
    expect(result).toEqual([]);
  });

  it("같은 날 매수 여러 건은 수량 합·가중평균 단가로 묶인다", () => {
    const result = groupTradeMarkers(times, [
      trade("2026-01-01T01:00:00Z", "buy", "QLD", { shares: 10, price: 100 }),
      trade("2026-01-01T02:00:00Z", "buy", "QLD", { shares: 10, price: 200 }),
    ]);
    expect(result[0].buyShares).toBe(20);
    expect(result[0].buyAvgPrice).toBeCloseTo(150); // (10*100+10*200)/20
  });

  it("같은 날 매도 여러 건은 수량 합·가중평균 단가·실현손익 합으로 묶인다", () => {
    const result = groupTradeMarkers(times, [
      trade("2026-01-01T01:00:00Z", "sell", "QLD", { shares: 5, price: 120, realizedKrw: 10_000 }),
      trade("2026-01-01T02:00:00Z", "sell", "QLD", { shares: 5, price: 140, realizedKrw: 20_000 }),
    ]);
    expect(result[0].sellShares).toBe(10);
    expect(result[0].sellAvgPrice).toBeCloseTo(130); // (5*120+5*140)/10
    expect(result[0].sellRealizedKrw).toBe(30_000);
  });

  it("매수만 있으면 매도 관련 필드는 전부 0이다", () => {
    const result = groupTradeMarkers(times, [trade("2026-01-01T00:00:00Z", "buy", "QLD", { shares: 3, price: 50 })]);
    expect(result[0]).toMatchObject({ sellShares: 0, sellAvgPrice: 0, sellRealizedKrw: 0, buyShares: 3, buyAvgPrice: 50 });
  });
});
