import type { Quote } from "@/lib/domain/types";

import { ProviderShapeError, requireNumber, type FxProvider, type QuoteProvider } from "./types";

/**
 * 미국 상장 종목용 공급자.
 *
 * 무료 플랜은 하루 호출 수와 분당 호출 수가 모두 제한된다. 페이지를 열 때마다
 * 부르지 말고 cron이 주기적으로 한 번씩만 불러 저장소에 적재하는 용도로 쓴다.
 */

const BASE = "https://api.twelvedata.com";

type RawQuote = {
  symbol?: string;
  close?: string | number;
  previous_close?: string | number;
  datetime?: string;
  is_market_open?: boolean;
  status?: string;
  code?: number;
  message?: string;
};

function parseQuote(symbolId: string, raw: RawQuote): Quote {
  if (raw.status === "error" || raw.code) {
    throw new ProviderShapeError("twelve-data", raw.message ?? `${symbolId} 조회 실패`);
  }
  return {
    symbolId,
    price: requireNumber(raw.close, "twelve-data", `${symbolId}.close`),
    prevClose: requireNumber(raw.previous_close, "twelve-data", `${symbolId}.previous_close`),
    currency: "USD",
    asOf: new Date().toISOString(),
    marketState: raw.is_market_open ? "open" : "closed",
  };
}

export function createTwelveDataProvider(apiKey: string): QuoteProvider {
  return {
    name: "twelve-data",
    supports: (symbol) => symbol.market === "US",

    async fetchQuotes(symbolIds) {
      if (symbolIds.length === 0) return [];

      // 한 번에 여러 심볼을 묶어 보내면 호출 수를 아낄 수 있다.
      const url = new URL(`${BASE}/quote`);
      url.searchParams.set("symbol", symbolIds.join(","));
      url.searchParams.set("apikey", apiKey);

      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) throw new ProviderShapeError("twelve-data", `HTTP ${response.status}`);
      const payload = (await response.json()) as RawQuote | Record<string, RawQuote>;

      // 심볼이 하나면 객체 하나로, 여럿이면 심볼을 키로 하는 객체로 온다.
      const quotes: Quote[] = [];
      if (symbolIds.length === 1) {
        quotes.push(parseQuote(symbolIds[0], payload as RawQuote));
      } else {
        for (const symbolId of symbolIds) {
          const raw = (payload as Record<string, RawQuote>)[symbolId];
          if (!raw) continue;
          try {
            quotes.push(parseQuote(symbolId, raw));
          } catch (error) {
            // 한 종목이 실패해도 나머지는 살린다.
            console.warn(`[twelve-data] ${symbolId} 건너뜀:`, (error as Error).message);
          }
        }
      }
      return quotes;
    },
  };
}

export function createTwelveDataFxProvider(apiKey: string): FxProvider {
  return {
    name: "twelve-data-fx",
    async fetchRate(from, to) {
      const url = new URL(`${BASE}/quote`);
      url.searchParams.set("symbol", `${from}/${to}`);
      url.searchParams.set("apikey", apiKey);

      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) throw new ProviderShapeError("twelve-data-fx", `HTTP ${response.status}`);
      const raw = (await response.json()) as RawQuote;
      if (raw.status === "error" || raw.code) throw new ProviderShapeError("twelve-data-fx", raw.message ?? "환율 조회 실패");

      return {
        rate: requireNumber(raw.close, "twelve-data-fx", "close"),
        prevRate: requireNumber(raw.previous_close, "twelve-data-fx", "previous_close"),
        asOf: new Date().toISOString(),
      };
    },
  };
}
