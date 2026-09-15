import type { Currency, Quote } from "@/lib/domain/types";

/**
 * 시세 공급자 인터페이스.
 *
 * 화면은 이 인터페이스 너머를 모른다. 지금은 로컬 JSON이 원본이지만,
 * Twelve Data든 증권사 API든 이 모양만 맞추면 코드를 고치지 않고 갈아끼울 수 있다.
 */
export type QuoteProvider = {
  /** 로그와 오류 메시지에 쓰는 이름 */
  readonly name: string;
  /** 이 공급자가 처리할 수 있는 심볼인지 */
  supports(symbol: { id: string; market: "US" | "KR" | "CASH" }): boolean;
  /** 여러 심볼을 한 번에. 실패한 심볼은 결과에서 빠진다. */
  fetchQuotes(symbolIds: string[]): Promise<Quote[]>;
};

export type FxProvider = {
  readonly name: string;
  fetchRate(from: Currency, to: Currency): Promise<{ rate: number; prevRate: number; asOf: string }>;
};

/** 공급자 응답이 예상과 다를 때 던진다. 크롤링 대상이 바뀌면 여기서 걸린다. */
export class ProviderShapeError extends Error {
  constructor(provider: string, detail: string) {
    super(`${provider} 응답 형식이 예상과 다릅니다: ${detail}`);
    this.name = "ProviderShapeError";
  }
}

export function requireNumber(value: unknown, provider: string, field: string): number {
  const parsed = typeof value === "number" ? value : Number(String(value ?? "").replace(/,/g, ""));
  if (!Number.isFinite(parsed)) throw new ProviderShapeError(provider, `${field} 가 숫자가 아닙니다 (${String(value)})`);
  return parsed;
}
