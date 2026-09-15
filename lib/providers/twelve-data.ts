import type { Quote } from "@/lib/domain/types";

import { ProviderShapeError, requireNumber, type FxProvider, type QuoteProvider } from "./types";

/**
 * 미국 상장 종목용 공급자.
 *
 * 무료 플랜은 하루 호출 수와 분당 호출 수가 모두 제한된다. 페이지를 열 때마다
 * 부르지 말고 cron이 주기적으로 한 번씩만 불러 저장소에 적재하는 용도로 쓴다.
 */

const BASE = "https://api.twelvedata.com";

/**
 * 무료 플랜은 분당 API 크레딧이 8개뿐이고, 심볼 하나당 1크레딧을 쓴다.
 * 여러 심볼을 한 URL에 묶어 보내도 크레딧은 심볼 수만큼 그대로 든다 — 호출
 * 횟수가 아니라 심볼 수가 기준이다. 그래서 실제 보유 종목이 8개를 넘으면
 * 한 번에 다 받으려다가 429로 전부 실패한다 (실거래 데이터로 처음 확인한 문제).
 * 분당 한도 안에 들어가게 나눠 보내고, 다음 분까지 기다렸다 이어서 보낸다.
 */
const MAX_SYMBOLS_PER_MINUTE = 8;
const CHUNK_WAIT_MS = 61_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

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

      const quotes: Quote[] = [];
      const groups = chunk(symbolIds, MAX_SYMBOLS_PER_MINUTE);

      for (const [index, group] of groups.entries()) {
        if (index > 0) await sleep(CHUNK_WAIT_MS);

        try {
          const url = new URL(`${BASE}/quote`);
          url.searchParams.set("symbol", group.join(","));
          url.searchParams.set("apikey", apiKey);

          const response = await fetch(url, { cache: "no-store" });
          if (!response.ok) throw new ProviderShapeError("twelve-data", `HTTP ${response.status}`);
          const payload = (await response.json()) as RawQuote | Record<string, RawQuote>;

          // 심볼이 하나면 객체 하나로, 여럿이면 심볼을 키로 하는 객체로 온다.
          if (group.length === 1) {
            quotes.push(parseQuote(group[0], payload as RawQuote));
          } else {
            for (const symbolId of group) {
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
        } catch (error) {
          // 한 묶음이 실패해도 이미 받은 앞 묶음 결과는 살리고 다음 묶음을 계속 시도한다.
          console.warn(`[twelve-data] ${group.join(",")} 묶음 건너뜀:`, (error as Error).message);
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
