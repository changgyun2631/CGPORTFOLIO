import { afterEach, describe, expect, it, vi } from "vitest";

import { createTwelveDataFxProvider, createTwelveDataProvider, parseQuote } from "../twelve-data";

/**
 * 실제 API를 부르지 않는다 — `global.fetch`를 모킹해서 (1) 매 요청에 timeout용
 * `signal`이 실제로 달리는지, (2) 응답이 끝없이 지연되는 상황(timeout으로 reject)
 * 이 나도 공급자가 매달리지 않고 정상적으로 끝나는지(WORK_ORDER B-0A-1)만 본다.
 */

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

function timeoutError(): Error {
  // Node의 AbortSignal.timeout()이 실제로 만드는 것과 같은 모양의 에러.
  const error = new DOMException("The operation was aborted due to timeout", "TimeoutError");
  return error as unknown as Error;
}

describe("createTwelveDataProvider", () => {
  it("요청마다 timeout용 signal을 붙인다", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ close: "1", previous_close: "1" }), { status: 200 }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const provider = createTwelveDataProvider("dummy-key");
    await provider.fetchQuotes(["QLD"]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const options = (fetchMock.mock.calls[0] as unknown as [RequestInfo, RequestInit])[1];
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });

  it("응답이 timeout으로 끝나도 매달리지 않고 빈 결과로 끝난다(해당 종목만 빠짐)", async () => {
    global.fetch = vi.fn(async () => {
      throw timeoutError();
    }) as unknown as typeof fetch;

    const provider = createTwelveDataProvider("dummy-key");
    const quotes = await provider.fetchQuotes(["QLD"]);

    expect(quotes).toEqual([]); // 실패한 묶음은 건너뛰고 함수는 정상적으로 반환된다
  });

  it("여러 묶음 중 하나만 timeout이면 나머지 묶음은 계속 처리된다", async () => {
    let call = 0;
    global.fetch = vi.fn(async () => {
      call += 1;
      if (call === 1) throw timeoutError();
      // 두 번째 묶음은 심볼 1개뿐이라 공급자가 "단일 심볼" 응답 모양(객체 하나)으로 파싱한다.
      return new Response(JSON.stringify({ close: "2", previous_close: "1.9" }), { status: 200 });
    }) as unknown as typeof fetch;

    // MAX_SYMBOLS_PER_MINUTE(8)를 넘겨 두 묶음으로 나뉘게 한다. 두 번째 묶음
    // 대기(61초)까지 실제로 기다리지 않도록 가짜 타이머를 쓴다.
    vi.useFakeTimers();
    const provider = createTwelveDataProvider("dummy-key");
    const symbols = Array.from({ length: 9 }, (_, i) => `SYM${i}`);
    const promise = provider.fetchQuotes(symbols);
    await vi.advanceTimersByTimeAsync(61_000);
    const quotes = await promise;
    vi.useRealTimers();

    expect(call).toBe(2);
    expect(quotes.some((q) => q.symbolId === "SYM8")).toBe(true);
  });
});

describe("parseQuote 프리·애프터마켓", () => {
  // 2026-10-27 정규장(동부 09:30~16:00)을 마친 종목. 마지막 정규장 체결 = 16:00 EDT.
  const session = { close: "208.56", previous_close: "199.78", datetime: "2026-10-27", last_quote_at: 1793131140, is_market_open: false };
  const at = (iso: string) => Date.parse(iso) / 1000;

  it("다음 거래일 프리마켓이면 프리 가격을 쓰고 직전 정규장 종가를 전일로 본다", () => {
    const quote = parseQuote("VRT", { ...session, extended_price: "243.73", extended_timestamp: at("2026-10-28T13:18:00Z") });
    expect(quote).toMatchObject({ price: 243.73, prevClose: 208.56, marketState: "pre" });
  });

  it("그날 정규장이 끝난 뒤 애프터마켓이면 전일 종가를 그대로 둬 하루 변동에 시간외를 합친다", () => {
    const quote = parseQuote("VRT", { ...session, extended_price: "210", extended_timestamp: at("2026-10-27T21:30:00Z") });
    expect(quote).toMatchObject({ price: 210, prevClose: 199.78, marketState: "post" });
  });

  it("시간외 체결이 정규장 마지막 체결보다 오래됐으면 정규장 가격을 쓴다", () => {
    const quote = parseQuote("VRT", { ...session, extended_price: "243.73", extended_timestamp: at("2026-10-27T12:00:00Z") });
    expect(quote).toMatchObject({ price: 208.56, prevClose: 199.78, marketState: "closed" });
  });

  it("정규장 중이거나 시간외 가격이 없으면 정규장 값 그대로", () => {
    expect(parseQuote("VRT", { ...session, is_market_open: true, extended_price: "1", extended_timestamp: at("2026-10-28T14:00:00Z") })).toMatchObject({ price: 208.56, marketState: "open" });
    expect(parseQuote("VRT", session)).toMatchObject({ price: 208.56, prevClose: 199.78 });
  });
});

describe("createTwelveDataFxProvider", () => {
  it("환율 요청에도 timeout용 signal을 붙인다", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ close: "1300", previous_close: "1290" }), { status: 200 }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const provider = createTwelveDataFxProvider("dummy-key");
    await provider.fetchRate("USD", "KRW");

    const options = (fetchMock.mock.calls[0] as unknown as [RequestInfo, RequestInit])[1];
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });

  it("환율 요청이 timeout이면 에러를 던진다(값을 지어내지 않는다)", async () => {
    global.fetch = vi.fn(async () => {
      throw timeoutError();
    }) as unknown as typeof fetch;

    const provider = createTwelveDataFxProvider("dummy-key");
    await expect(provider.fetchRate("USD", "KRW")).rejects.toThrow();
  });
});
