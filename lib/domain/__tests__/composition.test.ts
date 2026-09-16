import { describe, expect, it } from "vitest";
import { summarizeComposition, themeOf, unexplainedPercent } from "../composition";

describe("themeOf", () => {
  it("배수가 2 이상이면 레버리지, 1이면 지수 ETF", () => {
    expect(themeOf("QLD", "etf")).toBe("leverage");
    expect(themeOf("TQQQ", "etf")).toBe("leverage");
    expect(themeOf("QQQ", "etf")).toBe("index");
  });

  it("배수가 없는 ETF와 개별주를 나눈다", () => {
    expect(themeOf("SCHD", "etf")).toBe("etf");
    expect(themeOf("NVDA", "stock")).toBe("single");
  });

  it("현금은 종목 성격과 무관하게 현금이다", () => {
    expect(themeOf("CASH.USD", "cash")).toBe("cash");
  });
});

describe("summarizeComposition", () => {
  const entries = [
    { symbolId: "QLD", kind: "etf" as const, valueKrw: 200 },
    { symbolId: "SCHD", kind: "etf" as const, valueKrw: 100 },
    { symbolId: "NVDA", kind: "stock" as const, valueKrw: 600 },
    { symbolId: "CASH.USD", kind: "cash" as const, valueKrw: 100 },
  ];

  it("성격별로 묶고 위험이 큰 순서로 돌려준다", () => {
    const lines = summarizeComposition(entries, 1000);
    expect(lines.map((line) => line.theme)).toEqual(["leverage", "etf", "single", "cash"]);
    expect(lines[0].weightPercent).toBeCloseTo(20, 9);
    expect(lines[2].weightPercent).toBeCloseTo(60, 9);
  });

  it("비중의 분모는 넘겨준 계좌 전체 금액이지 합계가 아니다", () => {
    // 종가를 몰라 빠진 종목이 있어 합이 900뿐인 상황.
    const partial = entries.filter((entry) => entry.symbolId !== "CASH.USD");
    const lines = summarizeComposition(partial, 1000);
    expect(lines.reduce((sum, line) => sum + line.weightPercent, 0)).toBeCloseTo(90, 9);
  });

  it("비어 있으면 빈 목록이다", () => {
    expect(summarizeComposition([], 1000)).toEqual([]);
  });
});

describe("unexplainedPercent", () => {
  it("설명 못 한 몫을 비율로 돌려준다", () => {
    expect(unexplainedPercent([{ valueKrw: 900 }], 1000)).toBeCloseTo(10, 9);
    expect(unexplainedPercent([{ valueKrw: 1000 }], 1000)).toBeCloseTo(0, 9);
  });

  it("분모가 0이면 0이다", () => {
    expect(unexplainedPercent([{ valueKrw: 0 }], 0)).toBe(0);
  });
});
