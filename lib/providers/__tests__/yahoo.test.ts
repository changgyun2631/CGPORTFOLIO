import { afterEach, describe, expect, it, vi } from "vitest";

import { createYahooProvider, parseChart } from "../yahoo";

/** 정규장 = 13:30~20:00 UTC(동부 09:30~16:00). 마지막 봉이 어디 있느냐로 프리·장중·애프터를 가른다. */
const REGULAR = { start: 1793194200, end: 1793217600 };
const chart = (lastAt: number, close: number | null, extra = {}) => ({
  chart: {
    result: [
      {
        meta: { regularMarketPrice: 200, previousClose: 208.78, currentTradingPeriod: { regular: REGULAR }, ...extra },
        timestamp: [lastAt - 300, lastAt],
        indicators: { quote: [{ close: [199, close] }] },
      },
    ],
  },
});

describe("parseChart", () => {
  it("정규장 시작 전 마지막 봉이면 프리마켓 가격과 직전 종가를 돌려준다", () => {
    expect(parseChart("VRT", chart(REGULAR.start - 600, 243.5))).toMatchObject({ price: 243.5, prevClose: 208.78, marketState: "pre" });
  });

  it("정규장 중·마감 뒤 봉은 각각 open·post", () => {
    expect(parseChart("VRT", chart(REGULAR.start + 600, 235)).marketState).toBe("open");
    expect(parseChart("VRT", chart(REGULAR.end + 600, 210)).marketState).toBe("post");
  });

  it("마지막 봉 값이 비었으면 그 앞의 값을 쓴다", () => {
    expect(parseChart("VRT", chart(REGULAR.start + 600, null)).price).toBe(199);
  });

  it("결과가 없으면 에러를 던진다(값을 지어내지 않는다)", () => {
    expect(() => parseChart("XXX", { chart: { result: null as never, error: { description: "No data found" } } })).toThrow(/No data found/);
  });
});

describe("createYahooProvider", () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("BRK.B는 BRK-B로 부르고, 실패한 종목은 빼고 나머지를 돌려준다", async () => {
    const urls: string[] = [];
    global.fetch = vi.fn(async (url: RequestInfo | URL) => {
      urls.push(String(url));
      return String(url).includes("BAD") ? new Response("{}", { status: 404 }) : new Response(JSON.stringify(chart(REGULAR.start + 600, 100)), { status: 200 });
    }) as unknown as typeof fetch;

    const quotes = await createYahooProvider().fetchQuotes(["BRK.B", "BAD"]);

    expect(urls[0]).toContain("/BRK-B?");
    expect(quotes.map((q) => q.symbolId)).toEqual(["BRK.B"]);
  });
});
