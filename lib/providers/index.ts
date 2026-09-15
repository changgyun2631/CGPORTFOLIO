import type { Quote, Symbol } from "@/lib/domain/types";

import { createNaverKrProvider } from "./naver-kr";
import { createTwelveDataFxProvider, createTwelveDataProvider } from "./twelve-data";
import type { FxProvider, QuoteProvider } from "./types";

/**
 * 시장에 맞는 공급자를 골라 한 번에 시세를 모은다.
 *
 * 공급자를 바꾸거나 추가할 때 건드리는 곳은 여기 하나뿐이다.
 */

export function buildProviders(): QuoteProvider[] {
  const providers: QuoteProvider[] = [];

  const twelveDataKey = process.env.TWELVE_DATA_API_KEY;
  if (twelveDataKey) providers.push(createTwelveDataProvider(twelveDataKey));

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
