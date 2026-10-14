import { describe, expect, it } from "vitest";

import { buildDailyGains } from "../daily-gains";
import type { Snapshot, Transaction } from "../types";

// 환율 1000 고정. 스냅샷 "X일 07:00Z"는 뉴욕 새벽이라 "X−1일 종가"를 가리킨다.
const FX = [{ d: "2026-01-01", rate: 1000 }];
const snap = (at: string, totalKrw: number, principalKrw: number): Snapshot => ({ at, totalKrw, principalKrw, fxRate: 1000 });
const buy = (at: string, shares: number, price: number, extra: Partial<Transaction> = {}): Transaction => ({
  id: at + shares,
  at,
  accountId: "a",
  symbolId: "AAA",
  side: "buy",
  shares,
  price,
  ...extra,
});
const base = {
  fxHistory: FX,
  currencyOf: () => "USD" as const,
};

describe("buildDailyGains", () => {
  it("일 손익은 원금 대비 이익의 전일 증감이고, 종목 기여가 그대로 설명한다", () => {
    const rows = buildDailyGains({
      ...base,
      snapshots: [snap("2026-01-06T07:00:00Z", 100_000, 100_000), snap("2026-01-07T07:00:00Z", 110_000, 100_000)],
      transactions: [buy("2026-01-02T00:00:00Z", 10, 10)],
      priceHistory: { AAA: [{ d: "2026-01-05", c: 10 }, { d: "2026-01-06", c: 11 }] },
    });
    expect(rows[0]).toMatchObject({ date: "2026-01-06", dayGainKrw: null, contributions: [] });
    expect(rows[1]).toMatchObject({ dayGainKrw: 10_000, dayPercent: 10, contributions: [{ symbolId: "AAA", krw: 10_000 }], otherKrw: 0 });
  });

  it("입금은 상쇄돼 일 손익에 안 잡힌다", () => {
    const rows = buildDailyGains({
      ...base,
      snapshots: [snap("2026-01-06T07:00:00Z", 100_000, 100_000), snap("2026-01-07T07:00:00Z", 160_000, 150_000)],
      transactions: [buy("2026-01-02T00:00:00Z", 10, 10)],
      priceHistory: { AAA: [{ d: "2026-01-05", c: 10 }, { d: "2026-01-06", c: 11 }] },
    });
    expect(rows[1].dayGainKrw).toBe(10_000);
  });

  it("매수한 날은 산 금액이 아니라 가격 변동만 그 종목의 기여다", () => {
    const rows = buildDailyGains({
      ...base,
      snapshots: [snap("2026-01-06T07:00:00Z", 215_000, 215_000), snap("2026-01-07T07:00:00Z", 225_000, 215_000), snap("2026-01-08T07:00:00Z", 240_000, 215_000)],
      transactions: [buy("2026-01-02T00:00:00Z", 10, 10), buy("2026-01-07T12:00:00Z", 10, 11.5)],
      priceHistory: { AAA: [{ d: "2026-01-05", c: 10 }, { d: "2026-01-06", c: 11 }, { d: "2026-01-07", c: 12 }] },
    });
    // 평가액 240,000 − 전일 110,000 − 매수 115,000 = 15,000
    expect(rows[2]).toMatchObject({ dayGainKrw: 15_000, contributions: [{ symbolId: "AAA", krw: 15_000 }], otherKrw: 0 });
  });

  it("분할 전 수량도 소급 조정된 종가에 맞춰 평가한다", () => {
    const split = { ...buy("2026-01-07T12:00:00Z", 0, 0), side: "buy" as const, action: "split" as const, splitRatio: 2 };
    const rows = buildDailyGains({
      ...base,
      snapshots: [snap("2026-01-06T07:00:00Z", 100_000, 100_000), snap("2026-01-07T07:00:00Z", 110_000, 100_000), snap("2026-01-08T07:00:00Z", 120_000, 100_000)],
      transactions: [buy("2026-01-02T00:00:00Z", 10, 10), split],
      // 2:1 분할 뒤 기준으로 조정된 종가(실제 분할 전 가격의 절반)
      priceHistory: { AAA: [{ d: "2026-01-05", c: 5 }, { d: "2026-01-06", c: 5.5 }, { d: "2026-01-07", c: 6 }] },
    });
    expect(rows[1].contributions).toEqual([{ symbolId: "AAA", krw: 10_000 }]);
    expect(rows[2].contributions).toEqual([{ symbolId: "AAA", krw: 10_000 }]);
  });

  it("주말 점은 행을 만들지 않고 다음 거래일에 합친다(그 사이 매매도 이어진다)", () => {
    // 01-09 금, 01-10 토, 01-12 월. 토요일 점 직전에 10주를 더 샀다.
    const rows = buildDailyGains({
      ...base,
      snapshots: [snap("2026-01-09T07:00:00Z", 205_000, 205_000), snap("2026-01-10T07:00:00Z", 230_000, 205_000), snap("2026-01-12T07:00:00Z", 220_000, 205_000)],
      transactions: [buy("2026-01-02T00:00:00Z", 10, 10), buy("2026-01-09T12:00:00Z", 10, 10.5)],
      priceHistory: { AAA: [{ d: "2026-01-08", c: 10 }, { d: "2026-01-09", c: 11 }] },
    });
    expect(rows.map((r) => r.date)).toEqual(["2026-01-09", "2026-01-12"]);
    // 평가액 220,000 − 금요일 100,000 − 매수 105,000 = 15,000
    expect(rows[1]).toMatchObject({ dayGainKrw: 15_000, contributions: [{ symbolId: "AAA", krw: 15_000 }], otherKrw: 0 });
  });

  it("CSV 점(15:30 KST)은 시각이 아니라 일자 라벨의 종가로 평가한다", () => {
    const rows = buildDailyGains({
      ...base,
      snapshots: [snap("2026-01-05T15:30:00+09:00", 100_000, 100_000), snap("2026-01-06T15:30:00+09:00", 110_000, 100_000)],
      transactions: [buy("2026-01-02T00:00:00Z", 10, 10)],
      priceHistory: { AAA: [{ d: "2026-01-05", c: 10 }, { d: "2026-01-06", c: 11 }] },
    });
    expect(rows[1].contributions).toEqual([{ symbolId: "AAA", krw: 10_000 }]);
  });

  it("종가를 모르는 종목은 지어내지 않고 기타로 남긴다", () => {
    const rows = buildDailyGains({
      ...base,
      snapshots: [snap("2026-01-06T07:00:00Z", 100_000, 100_000), snap("2026-01-07T07:00:00Z", 110_000, 100_000)],
      transactions: [buy("2026-01-02T00:00:00Z", 10, 10)],
      priceHistory: {},
    });
    expect(rows[1]).toMatchObject({ contributions: [], dayGainKrw: 10_000, otherKrw: 10_000 });
  });
});
