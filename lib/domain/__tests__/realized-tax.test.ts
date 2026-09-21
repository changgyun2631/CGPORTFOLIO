import { describe, expect, it } from "vitest";

import {
  OVERSEAS_ANNUAL_DEDUCTION_KRW,
  OVERSEAS_TAX_RATE,
  summarizeRealizedByYear,
} from "../realized-tax";
import type { Symbol } from "../types";

const symbols: Symbol[] = [
  { id: "QLD", name: "QLD", kind: "etf", currency: "USD", market: "US" },
  { id: "491620", name: "국내ETF", kind: "etf", currency: "KRW", market: "KR" },
];

/** 환율은 날짜와 무관하게 고정 — 날짜별 환율 적용은 별도 테스트에서 본다. */
const flatFx = () => 1000;

describe("summarizeRealizedByYear", () => {
  it("연도별로 묶고 해외/국내를 나눠 합산한다", () => {
    const result = summarizeRealizedByYear({
      symbols,
      fxRateAt: flatFx,
      trades: [
        { at: "2025-03-02T10:00:00+09:00", symbolId: "QLD", realized: 1000 }, // 100만원
        { at: "2025-07-02T10:00:00+09:00", symbolId: "491620", realized: 500_000 },
        { at: "2026-02-02T10:00:00+09:00", symbolId: "QLD", realized: 2000 },
      ],
    });

    expect(result.map((y) => y.year)).toEqual(["2026", "2025"]); // 최신 연도 먼저
    const y2025 = result.find((y) => y.year === "2025")!;
    expect(y2025.overseasRealizedKrw).toBe(1_000_000);
    expect(y2025.domesticRealizedKrw).toBe(500_000);
    expect(y2025.totalRealizedKrw).toBe(1_500_000);
    expect(y2025.sellCount).toBe(2);
  });

  it("기본공제 안쪽이면 세금이 0이고 남은 공제를 알려준다", () => {
    const [year] = summarizeRealizedByYear({
      symbols,
      fxRateAt: flatFx,
      trades: [{ at: "2026-02-02T10:00:00+09:00", symbolId: "QLD", realized: 1000 }], // 100만원
    });

    expect(year.taxableKrw).toBe(0);
    expect(year.estimatedTaxKrw).toBe(0);
    expect(year.remainingDeductionKrw).toBe(OVERSEAS_ANNUAL_DEDUCTION_KRW - 1_000_000);
  });

  it("기본공제를 넘으면 초과분에만 세율을 매긴다", () => {
    const [year] = summarizeRealizedByYear({
      symbols,
      fxRateAt: flatFx,
      trades: [{ at: "2026-02-02T10:00:00+09:00", symbolId: "QLD", realized: 5000 }], // 500만원
    });

    const taxable = 5_000_000 - OVERSEAS_ANNUAL_DEDUCTION_KRW;
    expect(year.taxableKrw).toBe(taxable);
    expect(year.estimatedTaxKrw).toBeCloseTo(taxable * OVERSEAS_TAX_RATE);
    expect(year.remainingDeductionKrw).toBe(0);
  });

  it("국내 종목 이익은 양도세 계산에 넣지 않는다", () => {
    const [year] = summarizeRealizedByYear({
      symbols,
      fxRateAt: flatFx,
      trades: [{ at: "2026-02-02T10:00:00+09:00", symbolId: "491620", realized: 10_000_000 }],
    });

    expect(year.domesticRealizedKrw).toBe(10_000_000);
    expect(year.overseasRealizedKrw).toBe(0);
    expect(year.estimatedTaxKrw).toBe(0);
  });

  it("같은 해 손익은 통산한다 — 손실이 이익을 깎는다", () => {
    const [year] = summarizeRealizedByYear({
      symbols,
      fxRateAt: flatFx,
      trades: [
        { at: "2026-02-02T10:00:00+09:00", symbolId: "QLD", realized: 5000 }, // +500만
        { at: "2026-08-02T10:00:00+09:00", symbolId: "QLD", realized: -3000 }, // -300만
      ],
    });

    expect(year.overseasRealizedKrw).toBe(2_000_000);
    expect(year.taxableKrw).toBe(0); // 공제 250만원 안쪽
  });

  it("연간 합계가 손실이면 세금도 0, 공제도 그대로 남는다", () => {
    const [year] = summarizeRealizedByYear({
      symbols,
      fxRateAt: flatFx,
      trades: [{ at: "2026-02-02T10:00:00+09:00", symbolId: "QLD", realized: -4000 }],
    });

    expect(year.overseasRealizedKrw).toBe(-4_000_000);
    expect(year.taxableKrw).toBe(0);
    expect(year.estimatedTaxKrw).toBe(0);
    expect(year.remainingDeductionKrw).toBe(OVERSEAS_ANNUAL_DEDUCTION_KRW);
  });

  it("거래일 환율로 환산한다 — 오늘 환율 하나로 뭉뚱그리지 않는다", () => {
    const fxByDate: Record<string, number> = { "2026-02-02": 1200, "2026-08-02": 1500 };
    const [year] = summarizeRealizedByYear({
      symbols,
      fxRateAt: (date) => fxByDate[date] ?? 1000,
      trades: [
        { at: "2026-02-02T10:00:00+09:00", symbolId: "QLD", realized: 1000 },
        { at: "2026-08-02T10:00:00+09:00", symbolId: "QLD", realized: 1000 },
      ],
    });

    expect(year.overseasRealizedKrw).toBe(1000 * 1200 + 1000 * 1500);
  });

  it("실현손익이 0인 매수 거래와 모르는 종목은 건너뛴다", () => {
    const result = summarizeRealizedByYear({
      symbols,
      fxRateAt: flatFx,
      trades: [
        { at: "2026-02-02T10:00:00+09:00", symbolId: "QLD", realized: 0 },
        { at: "2026-02-03T10:00:00+09:00", symbolId: "없는종목", realized: 1000 },
      ],
    });

    expect(result).toEqual([]);
  });

  it("매도 수수료를 연도별로 따로 합산한다 — 증권사 화면 대조용", () => {
    const [year] = summarizeRealizedByYear({
      symbols,
      fxRateAt: () => 1300,
      trades: [
        { at: "2026-02-02T10:00:00+09:00", symbolId: "QLD", realized: 1000, fee: 10 },
        { at: "2026-03-02T10:00:00+09:00", symbolId: "QLD", realized: 500, fee: 5 },
        // 국내 종목은 환산 없이 그대로 더한다.
        { at: "2026-04-02T10:00:00+09:00", symbolId: "491620", realized: 10_000, fee: 1_000 },
      ],
    });

    expect(year.sellFeeKrw).toBe(10 * 1300 + 5 * 1300 + 1_000);
  });

  it("수수료 정보가 없으면 0으로 둔다", () => {
    const [year] = summarizeRealizedByYear({
      symbols,
      fxRateAt: flatFx,
      trades: [{ at: "2026-02-02T10:00:00+09:00", symbolId: "QLD", realized: 1000 }],
    });

    expect(year.sellFeeKrw).toBe(0);
  });

  it("KST 기준으로 연도를 끊는다 — UTC로 끊으면 연말 거래가 전년으로 밀린다", () => {
    const [year] = summarizeRealizedByYear({
      symbols,
      fxRateAt: flatFx,
      // 2026-01-01 08:00 KST = 2025-12-31 23:00 UTC. 과세기간은 한국 기준이라 2026년이다.
      trades: [{ at: "2026-01-01T08:00:00+09:00", symbolId: "QLD", realized: 1000 }],
    });

    expect(year.year).toBe("2026");
  });
});
