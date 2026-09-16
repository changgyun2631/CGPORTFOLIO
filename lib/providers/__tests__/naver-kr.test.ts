import { afterEach, describe, expect, it, vi } from "vitest";

import { createNaverKrProvider } from "../naver-kr";

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

function timeoutError(): Error {
  return new DOMException("The operation was aborted due to timeout", "TimeoutError") as unknown as Error;
}

describe("createNaverKrProvider", () => {
  it("요청마다 timeout용 signal을 붙인다", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ datas: [{ closePrice: "10000", compareToPreviousClosePrice: "100", marketStatus: "OPEN" }] }), {
          status: 200,
        }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    const provider = createNaverKrProvider();
    await provider.fetchQuotes(["418660"]);

    const options = (fetchMock.mock.calls[0] as unknown as [RequestInfo, RequestInit])[1];
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });

  it("한 종목이 timeout이어도 매달리지 않고, 나머지 종목은 계속 처리된다", async () => {
    let call = 0;
    global.fetch = vi.fn(async () => {
      call += 1;
      if (call === 1) throw timeoutError();
      return new Response(
        JSON.stringify({ datas: [{ closePrice: "5000", compareToPreviousClosePrice: "-50", marketStatus: "CLOSE" }] }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    const provider = createNaverKrProvider();
    const quotes = await provider.fetchQuotes(["418660", "0015B0"]);

    expect(call).toBe(2);
    expect(quotes).toHaveLength(1); // timeout난 첫 종목만 빠짐
    expect(quotes[0].symbolId).toBe("0015B0");
  });
});
