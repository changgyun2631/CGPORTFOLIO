import { describe, expect, it } from "vitest";
import { mergePriceHistory, parseTimeSeriesResponse } from "../price-history.mjs";

function payload(values) {
  return { status: "ok", values };
}

describe("parseTimeSeriesResponse", () => {
  it("최신순 응답을 과거→최신 순으로 뒤집는다", () => {
    const result = parseTimeSeriesResponse(
      "QLD",
      payload([
        { datetime: "2026-01-03", close: "3" },
        { datetime: "2026-01-02", close: "2" },
        { datetime: "2026-01-01", close: "1" },
      ]),
    );
    expect(result).toEqual([
      { d: "2026-01-01", c: 1 },
      { d: "2026-01-02", c: 2 },
      { d: "2026-01-03", c: 3 },
    ]);
  });

  it("응답 status가 error면 던진다", () => {
    expect(() => parseTimeSeriesResponse("BAD", { status: "error", message: "심볼 없음" })).toThrow("심볼 없음");
  });

  it("values가 없으면 던진다", () => {
    expect(() => parseTimeSeriesResponse("QLD", { status: "ok" })).toThrow("values가 없습니다");
  });

  it("close가 숫자가 아니면 던진다", () => {
    expect(() => parseTimeSeriesResponse("QLD", payload([{ datetime: "2026-01-01", close: "abc" }]))).toThrow(
      "숫자가 아닙니다",
    );
  });

  it("datetime 형식이 이상하면 던진다", () => {
    expect(() => parseTimeSeriesResponse("QLD", payload([{ datetime: "이상함", close: "1" }]))).toThrow(
      "datetime 형식이 이상합니다",
    );
  });

  it("datetime이 시각까지 포함해도(1min 등) 날짜만 잘라 쓴다", () => {
    const result = parseTimeSeriesResponse("QLD", payload([{ datetime: "2026-01-01 09:30:00", close: "1" }]));
    expect(result).toEqual([{ d: "2026-01-01", c: 1 }]);
  });
});

describe("mergePriceHistory", () => {
  it("새로 받은 종목은 덮어쓰고, 못 받은 종목은 기존 값을 그대로 둔다", () => {
    const existing = { QLD: [{ d: "2020-01-01", c: 1 }], SCHD: [{ d: "2020-01-01", c: 2 }] };
    const fetched = { QLD: [{ d: "2026-01-01", c: 99 }] }; // SCHD는 이번에 못 받음(실패)
    expect(mergePriceHistory(existing, fetched)).toEqual({
      QLD: [{ d: "2026-01-01", c: 99 }],
      SCHD: [{ d: "2020-01-01", c: 2 }],
    });
  });

  it("기존에 없던 새 종목도 추가된다", () => {
    const existing = { QLD: [{ d: "2020-01-01", c: 1 }] };
    const fetched = { NVDA: [{ d: "2026-01-01", c: 5 }] };
    expect(mergePriceHistory(existing, fetched)).toEqual({
      QLD: [{ d: "2020-01-01", c: 1 }],
      NVDA: [{ d: "2026-01-01", c: 5 }],
    });
  });
});
