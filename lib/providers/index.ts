import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { Quote, Symbol } from "@/lib/domain/types";

import { createNaverKrProvider } from "./naver-kr";
import { createTwelveDataFxProvider, createTwelveDataProvider } from "./twelve-data";
import type { FxProvider, QuoteProvider } from "./types";
import { createYahooProvider } from "./yahoo";

/**
 * 시장에 맞는 공급자를 골라 한 번에 시세를 모은다.
 *
 * 공급자를 바꾸거나 추가할 때 건드리는 곳은 여기 하나뿐이다.
 */

/**
 * Twelve Data는 하루 크레딧이 모자라서(종목 하나에 1) Yahoo가 막혔을 때의 예비로만 쓴다. 갱신이 자주 돌 때
 * Yahoo가 계속 실패해도 크레딧을 다 쓰지 않도록, 마지막으로 부른 시각을 파일에 적어 두고 그 뒤 `minGapMs` 동안은 건너뛴다.
 */
function throttled(provider: QuoteProvider, stampPath: string, minGapMs: number): QuoteProvider {
  return {
    ...provider,
    async fetchQuotes(symbolIds) {
      try {
        if (Date.now() - Number(readFileSync(stampPath, "utf8")) < minGapMs) return [];
      } catch {}
      try {
        writeFileSync(stampPath, String(Date.now())); // 실패해도 쓴 것으로 센다
      } catch {}
      return provider.fetchQuotes(symbolIds);
    },
  };
}

export function buildProviders(): QuoteProvider[] {
  const providers: QuoteProvider[] = [createYahooProvider()];

  const twelveDataKey = process.env.TWELVE_DATA_API_KEY;
  if (twelveDataKey) {
    providers.push(throttled(createTwelveDataProvider(twelveDataKey), join(process.cwd(), "data", ".twelve-quote-at"), 5 * 3_600_000));
  }

  providers.push(createNaverKrProvider());

  return providers;
}

export function buildFxProvider(): FxProvider | null {
  const twelveDataKey = process.env.TWELVE_DATA_API_KEY;
  return twelveDataKey ? createTwelveDataFxProvider(twelveDataKey) : null;
}

export type FetchReport = {
  quotes: Quote[];
  /** 어떤 공급자도 맡지 않았거나 조회에 실패한 심볼 */
  missing: string[];
  errors: { provider: string; message: string }[];
};

export async function fetchAllQuotes(symbols: Symbol[], providers = buildProviders()): Promise<FetchReport> {
  // 예수금은 시세를 받을 대상이 아니다.
  const targets = symbols.filter((symbol) => symbol.kind !== "cash");

  const quotes: Quote[] = [];
  const errors: FetchReport["errors"] = [];
  const handled = new Set<string>();

  for (const provider of providers) {
    const mine = targets.filter((symbol) => !handled.has(symbol.id) && provider.supports(symbol));
    if (mine.length === 0) continue;

    try {
      const fetched = await provider.fetchQuotes(mine.map((symbol) => symbol.id));
      for (const quote of fetched) {
        quotes.push(quote);
        handled.add(quote.symbolId);
      }
    } catch (error) {
      errors.push({ provider: provider.name, message: (error as Error).message });
    }
  }

  return {
    quotes,
    missing: targets.filter((symbol) => !handled.has(symbol.id)).map((symbol) => symbol.id),
    errors,
  };
}
