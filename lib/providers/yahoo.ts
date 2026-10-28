import type { Quote } from "@/lib/domain/types";

import { ProviderShapeError, requireNumber, type QuoteProvider } from "./types";

/**
 * 미국 상장 종목의 장중·프리·애프터마켓 시세. Yahoo Finance 차트 조회를 종목마다 한 번씩 부른다.
 *
 * Twelve Data 무료 플랜은 하루 800크레딧이라 하루 몇 번밖에 못 부르지만, 이쪽은 횟수 제한이 없어서
 * 장중에 자주 갱신할 수 있다. 같은 이유로 가장 먼저 부르고, 실패한 종목만 다음 공급자(Twelve Data)로 넘어간다.
 *
 * 전제와 한계: 공식 API가 아니라 응답이 예고 없이 바뀌거나 막힐 수 있다(그러면 ProviderShapeError로 터지고
 * 그 종목은 다음 공급자가 받는다). 개인용으로 종목 사이에 간격을 두고 순차로 부른다.
 */

const BASE = "https://query1.finance.yahoo.com/v8/finance/chart";
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64)";
/** 종목 사이 최소 간격(ms) — 상대 서버에 부담을 주지 않기 위한 예의. */
const MIN_INTERVAL_MS = 200;
const REQUEST_TIMEOUT_MS = 15_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type RawChart = {
  chart?: {
    result?: {
      meta?: {
        regularMarketPrice?: number;
        /** `range=1d`에서는 직전 거래일 종가 — 프리마켓엔 마지막 정규장 종가, 장 중·애프터엔 전일 종가다. */
        previousClose?: number;
        chartPreviousClose?: number;
        currentTradingPeriod?: { regular?: { start?: number; end?: number } };
      };
      timestamp?: number[];
      indicators?: { quote?: { close?: (number | null)[] }[] };
    }[];
    error?: { description?: string } | null;
  };
};

/** 차트 응답 → 시세. 마지막 5분봉(프리·애프터 포함) 가격을 현재가로 쓴다. */
export function parseChart(symbolId: string, payload: RawChart): Quote {
  const result = payload.chart?.result?.[0];
  if (!result?.meta) throw new ProviderShapeError("yahoo", payload.chart?.error?.description ?? `${symbolId} 결과가 비어 있습니다`);

  const { meta } = result;
  const timestamps = result.timestamp ?? [];
  const closes = result.indicators?.quote?.[0]?.close ?? [];
  let last = closes.length - 1;
  while (last >= 0 && closes[last] == null) last -= 1;

  const price = requireNumber(last >= 0 ? closes[last] : meta.regularMarketPrice, "yahoo", `${symbolId}.price`);
  const prevClose = requireNumber(meta.previousClose ?? meta.chartPreviousClose, "yahoo", `${symbolId}.previousClose`);

  // 마지막 봉이 정규장 시간 앞이면 프리, 뒤면 애프터.
  const regular = meta.currentTradingPeriod?.regular;
  const at = last >= 0 ? timestamps[last] : undefined;
  const marketState: Quote["marketState"] =
    at == null || regular?.start == null || regular.end == null ? "closed" : at < regular.start ? "pre" : at >= regular.end ? "post" : "open";

  return { symbolId, price, prevClose, currency: "USD", asOf: new Date().toISOString(), marketState };
}

export function createYahooProvider(): QuoteProvider {
  return {
    name: "yahoo",
    supports: (symbol) => symbol.market === "US",

    async fetchQuotes(symbolIds) {
      const quotes: Quote[] = [];

      for (const [index, symbolId] of symbolIds.entries()) {
        if (index > 0) await sleep(MIN_INTERVAL_MS);

        try {
          // BRK.B처럼 점이 든 티커는 Yahoo에서 BRK-B로 쓴다.
          const url = `${BASE}/${encodeURIComponent(symbolId.replace(".", "-"))}?interval=5m&range=1d&includePrePost=true`;
          const response = await fetch(url, { cache: "no-store", headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
          if (!response.ok) throw new ProviderShapeError("yahoo", `${symbolId} HTTP ${response.status}`);
          quotes.push(parseChart(symbolId, (await response.json()) as RawChart));
        } catch (error) {
          // 한 종목이 실패해도 나머지는 계속 간다. 빠진 종목은 다음 공급자가 받는다.
          console.warn(`[yahoo] ${symbolId} 건너뜀:`, (error as Error).message);
        }
      }

      return quotes;
    },
  };
}
