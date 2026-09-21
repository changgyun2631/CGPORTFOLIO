import type { Account, Symbol } from "./types";

/**
 * 연도별 실현손익과 해외주식 양도소득세 추정.
 *
 * 실현손익 자체는 이미 `annotateTradesWithRealized`가 거래마다 계산해 둔다 —
 * 여기서는 그걸 연도로 묶고 원화로 환산한 뒤, 해외주식 양도소득세 규칙을
 * 얹기만 한다.
 *
 * **이 값은 신고용이 아니라 참고용 추정이다.** 실제 세법과 다음 두 가지가 다르다.
 *  1. 세법은 양도가액과 취득가액을 각각 그 결제일 기준환율로 환산해 차익을 낸다.
 *     여기서는 종목 통화 기준 차익을 구한 뒤 매도일 환율 하나로만 환산하므로,
 *     보유 기간 동안의 환율 변동만큼 차이가 난다(이동평균법이라 취득 시점
 *     환율을 로트별로 갖고 있지 않아서 더 정확히는 못 낸다).
 *  2. 기본공제·세율은 아래 상수로 고정돼 있다. 세법이 바뀌면 여기를 고쳐야 한다.
 */

/** 해외주식 양도소득 기본공제(연 단위, 원). */
export const OVERSEAS_ANNUAL_DEDUCTION_KRW = 2_500_000;

/** 양도소득세 20% + 지방소득세 2%. */
export const OVERSEAS_TAX_RATE = 0.22;

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** 과세기간은 한국 기준 1/1~12/31이다 — 실행 머신 타임존과 무관하게 KST로 끊는다. */
function taxYearOf(iso: string): string {
  return String(new Date(Date.parse(iso) + KST_OFFSET_MS).getUTCFullYear());
}

export type RealizedTrade = {
  at: string;
  accountId: string;
  symbolId: string;
  /** 종목 통화 기준 실현손익(수수료 반영) */
  realized: number;
  /** 그 매도에서 뺀 수수료(종목 통화 기준). 증권사 화면과 대조할 때 쓴다. */
  fee?: number;
};

/**
 * 실현손익을 과세 성격으로 가른다.
 *  - `overseas`: 위탁 계좌의 해외주식 → 양도소득세 대상
 *  - `domestic`: 위탁 계좌의 국내상장 → 대주주가 아니면 비과세
 *  - `pension`: 연금저축·퇴직연금 등 세제혜택 계좌 → 매매차익에는 양도세가
 *    안 붙는다(나중에 연금으로 받을 때 연금소득세로 과세된다)
 */
export type RealizedBucket = "overseas" | "domestic" | "pension";

export type RealizedSymbolLine = {
  symbolId: string;
  name: string;
  bucket: RealizedBucket;
  realizedKrw: number;
  tradeCount: number;
};

export type RealizedYear = {
  year: string;
  /** 위탁 계좌의 해외주식(양도세 대상) 실현손익 합계 */
  overseasRealizedKrw: number;
  /** 위탁 계좌의 국내상장(대주주가 아니면 비과세) 실현손익 합계 */
  domesticRealizedKrw: number;
  /** 연금저축·퇴직연금 등 세제혜택 계좌의 실현손익 합계 — 양도세 계산에서 뺀다 */
  pensionRealizedKrw: number;
  totalRealizedKrw: number;
  /**
   * 그 해 매도에서 차감한 수수료 합계(원). 증권사 실현손익 화면은 수수료를
   * 덜 빼고 보여주는 경우가 있어, 대조하려면 이 값을 도로 더해봐야 한다
   * (매수 수수료는 취득원가에 녹아 있어 연도별로 못 가른다 — 매도분만이다).
   */
  sellFeeKrw: number;
  sellCount: number;
  /** 기본공제를 뺀 과세표준. 손실이면 0이다. */
  taxableKrw: number;
  estimatedTaxKrw: number;
  /** 올해 아직 안 쓴 기본공제 */
  remainingDeductionKrw: number;
  lines: RealizedSymbolLine[];
};

/**
 * 거래별 실현손익을 연도로 묶는다. 각 거래는 그 거래일 환율로 원화 환산한다 —
 * 오늘 환율 하나로 과거 실현손익까지 환산하면 연도별 금액이 환율 변동만큼
 * 왜곡된다.
 */
export function summarizeRealizedByYear(input: {
  trades: RealizedTrade[];
  symbols: Symbol[];
  accounts: Account[];
  fxRateAt: (date: string) => number;
}): RealizedYear[] {
  const { trades, symbols, accounts, fxRateAt } = input;
  const symbolById = new Map(symbols.map((symbol) => [symbol.id, symbol]));
  const accountById = new Map(accounts.map((account) => [account.id, account]));

  const byYear = new Map<string, Map<string, RealizedSymbolLine>>();
  const sellCountByYear = new Map<string, number>();
  const sellFeeKrwByYear = new Map<string, number>();

  for (const trade of trades) {
    // 매수 거래는 실현손익이 0으로 들어온다 — 집계에서 빼야 "매도 몇 건"이 맞는다.
    if (trade.realized === 0) continue;
    const symbol = symbolById.get(trade.symbolId);
    if (!symbol) continue;

    const year = taxYearOf(trade.at);
    const rate = symbol.currency === "USD" ? fxRateAt(trade.at.slice(0, 10)) : 1;
    const realizedKrw = trade.realized * rate;
    sellFeeKrwByYear.set(year, (sellFeeKrwByYear.get(year) ?? 0) + (trade.fee ?? 0) * rate);

    const bucket: RealizedBucket = accountById.get(trade.accountId)?.taxDeferred
      ? "pension"
      : symbol.market === "US"
        ? "overseas"
        : "domestic";

    // 같은 종목이라도 과세 계좌와 연금 계좌에 나눠 담을 수 있어, 성격까지 키에 넣는다.
    const lines = byYear.get(year) ?? new Map<string, RealizedSymbolLine>();
    const key = `${trade.symbolId}::${bucket}`;
    const line = lines.get(key) ?? {
      symbolId: trade.symbolId,
      name: symbol.name,
      bucket,
      realizedKrw: 0,
      tradeCount: 0,
    };
    line.realizedKrw += realizedKrw;
    line.tradeCount += 1;
    lines.set(key, line);
    byYear.set(year, lines);
    sellCountByYear.set(year, (sellCountByYear.get(year) ?? 0) + 1);
  }

  const sumOf = (lines: RealizedSymbolLine[], bucket: RealizedBucket) =>
    lines.filter((line) => line.bucket === bucket).reduce((sum, line) => sum + line.realizedKrw, 0);

  return [...byYear.entries()]
    .map(([year, lines]) => {
      const all = [...lines.values()].sort((a, b) => b.realizedKrw - a.realizedKrw);
      const overseasRealizedKrw = sumOf(all, "overseas");
      const domesticRealizedKrw = sumOf(all, "domestic");
      const pensionRealizedKrw = sumOf(all, "pension");
      const taxableKrw = Math.max(overseasRealizedKrw - OVERSEAS_ANNUAL_DEDUCTION_KRW, 0);

      return {
        year,
        overseasRealizedKrw,
        domesticRealizedKrw,
        pensionRealizedKrw,
        totalRealizedKrw: overseasRealizedKrw + domesticRealizedKrw + pensionRealizedKrw,
        sellFeeKrw: sellFeeKrwByYear.get(year) ?? 0,
        sellCount: sellCountByYear.get(year) ?? 0,
        taxableKrw,
        estimatedTaxKrw: taxableKrw * OVERSEAS_TAX_RATE,
        remainingDeductionKrw: Math.max(
          OVERSEAS_ANNUAL_DEDUCTION_KRW - Math.max(overseasRealizedKrw, 0),
          0,
        ),
        lines: all,
      } satisfies RealizedYear;
    })
    .sort((a, b) => b.year.localeCompare(a.year));
}
