import type { Quote } from "@/lib/domain/types";

import { ProviderShapeError, requireNumber, type QuoteProvider } from "./types";

/**
 * 국내 상장 ETF 시세.
 *
 * 국내 종목은 Twelve Data가 다루지 않아 별도 경로가 필요하다. 여기서는 공개
 * 페이지가 쓰는 조회 엔드포인트를 그대로 호출한다.
 *
 * 전제와 한계를 분명히 해 둔다.
 *  - 공식 API가 아니다. 응답 구조가 예고 없이 바뀔 수 있고, 바뀌면 여기서 즉시
 *    ProviderShapeError로 터진다. 조용히 틀린 값을 쓰는 것보다 낫다.
 *  - 개인용 대시보드가 하루 몇 번 부르는 수준을 전제로 한다. 호출 간격을 두고,
 *    종목마다 순차로 부른다.
 *  - 상용으로 쓰려면 증권사 Open API 같은 정식 경로로 갈아타야 한다.
 *    그때는 이 파일만 새로 쓰면 되고 나머지 코드는 그대로다.
 */

const ENDPOINT = "https://polling.finance.naver.com/api/realtime/domestic/stock";

/** 호출 사이에 두는 최소 간격(ms). 상대 서버에 부담을 주지 않기 위한 예의. */
const MIN_INTERVAL_MS = 400;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type RawDatum = {
  itemCode?: string;
  closePrice?: string | number;
  compareToPreviousClosePrice?: string | number;
  stockExchangeType?: unknown;
};

function parseQuote(symbolId: string, datum: RawDatum): Quote {
  const close = requireNumber(datum.closePrice, "naver-kr", `${symbolId}.closePrice`);
  const change = requireNumber(datum.compareToPreviousClosePrice, "naver-kr", `${symbolId}.compareToPreviousClosePrice`);
  return {
    symbolId,
    price: close,
    // 전일 종가를 따로 주지 않으므로 현재가에서 변동분을 빼서 되돌린다.
    prevClose: close - change,
    currency: "KRW",
    asOf: new Date().toISOString(),
    marketState: "closed",
  };
}

export function createNaverKrProvider(): QuoteProvider {
  return {
    name: "naver-kr",
    supports: (symbol) => symbol.market === "KR",

    async fetchQuotes(symbolIds) {
      const quotes: Quote[] = [];

      for (const [index, symbolId] of symbolIds.entries()) {
        if (index > 0) await sleep(MIN_INTERVAL_MS);

        try {
          const response = await fetch(`${ENDPOINT}/${encodeURIComponent(symbolId)}`, {
            cache: "no-store",
            headers: { accept: "application/json" },
          });
          if (!response.ok) throw new ProviderShapeError("naver-kr", `${symbolId} HTTP ${response.status}`);

          const payload = (await response.json()) as { datas?: RawDatum[] };
          const datum = payload.datas?.[0];
          if (!datum) throw new ProviderShapeError("naver-kr", `${symbolId} datas 가 비어 있습니다`);

          quotes.push(parseQuote(symbolId, datum));
        } catch (error) {
          // 한 종목이 실패해도 나머지는 계속 간다. 빠진 종목은 호출한 쪽이 알 수 있다.
          console.warn(`[naver-kr] ${symbolId} 건너뜀:`, (error as Error).message);
        }
      }

      return quotes;
    },
  };
}
