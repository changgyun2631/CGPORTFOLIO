import "server-only";

import { cache } from "react";

import { runBacktest } from "@/lib/domain/backtest";
import { summarizeComposition, unexplainedPercent } from "@/lib/domain/composition";
import { summarizeDividends } from "@/lib/domain/dividends";
import { positionValuesAsOf, qqqExposureAt, summarizeQqqExposure } from "@/lib/domain/exposure";
import { analyzeSeries, cashflowAdjustedDrawdown, filterSnapshots } from "@/lib/domain/metrics";
import { expandHoldings, groupBySector } from "@/lib/domain/lookthrough";
import { annotateTradesWithRealized, buildPortfolio, summarizeAccounts } from "@/lib/domain/portfolio";
import type { PointInTime } from "@/lib/domain/weekly-report";

import {
  getAccounts,
  getBacktestConfigs,
  getCashFlows,
  getDividends,
  getFxHistory,
  getFxQuote,
  getLookthrough,
  getPositionBasis,
  getPriceHistory,
  getTotalReturnPriceHistory,
  getQuotes,
  getSnapshots,
  getSymbols,
  getTransactions,
  readJsonUncached,
} from "./store";
import type {
  Account,
  CashFlow,
  DividendPayment,
  FxRate,
  LookthroughTable,
  PositionBasis,
  Quote,
  Snapshot,
  Symbol,
  Transaction,
} from "@/lib/domain/types";

/**
 * 페이지가 쓰는 뷰모델을 한 곳에서 조립한다.
 *
 * react cache 로 감싸 두었으므로 한 요청 안에서 여러 컴포넌트가 불러도
 * 계산은 한 번만 돈다.
 */

export const loadRaw = cache(async () => {
  const [accounts, symbols, transactions, cashflows, dividends, positionBasis, quotes, fx, snapshots, lookthrough, fxHistory] = await Promise.all([
    getAccounts(),
    getSymbols(),
    getTransactions(),
    getCashFlows(),
    getDividends(),
    getPositionBasis(),
    getQuotes(),
    getFxQuote(),
    getSnapshots(),
    getLookthrough(),
    getFxHistory(),
  ]);
  return { accounts, symbols, transactions, cashflows, dividends, positionBasis, quotes, fx, snapshots, lookthrough, fxHistory };
});

/**
 * `loadRaw()`와 같은 파일 묶음을 캐시 없이(=지금 이 순간의 디스크 값으로) 읽는다.
 * 목록은 `loadRaw()`와 반드시 같이 맞출 것 — 필드가 어긋나면
 * `lib/data/__tests__/views-raw-parity.test.ts`가 잡는다.
 */
export async function loadRawUncached() {
  const [accounts, symbols, transactions, cashflows, dividends, positionBasis, quotes, fx, snapshots, lookthrough, fxHistory] = await Promise.all([
    readJsonUncached<Account[]>("accounts.json"),
    readJsonUncached<Symbol[]>("symbols.json"),
    readJsonUncached<Transaction[]>("transactions.json"),
    readJsonUncached<CashFlow[]>("cashflows.json"),
    readJsonUncached<DividendPayment[]>("dividends.json"),
    readJsonUncached<PositionBasis[]>("position-basis.json").catch(() => [] as PositionBasis[]),
    readJsonUncached<Quote[]>("quotes.json"),
    readJsonUncached<FxRate>("fx-quote.json"),
    readJsonUncached<Snapshot[]>("snapshots.json"),
    readJsonUncached<LookthroughTable>("lookthrough.json"),
    readJsonUncached<{ d: string; rate: number }[]>("fx.json"),
  ]);
  return { accounts, symbols, transactions, cashflows, dividends, positionBasis, quotes, fx, snapshots, lookthrough, fxHistory };
}

/** 과거 환율 조회. 없는 날짜는 그 이전 마지막 값을 쓴다. */
export function makeFxLookup(history: { d: string; rate: number }[], fallback: number) {
  if (history.length === 0) return () => fallback;
  const sorted = [...history].sort((a, b) => a.d.localeCompare(b.d));
  return (date: string) => {
    let last = sorted[0].rate;
    for (const point of sorted) {
      if (point.d > date) break;
      last = point.rate;
    }
    return last;
  };
}

export const loadPortfolio = cache(async () => {
  const raw = await loadRaw();
  const fxRateAt = makeFxLookup(raw.fxHistory, raw.fx.rate);

  const portfolio = buildPortfolio({
    accounts: raw.accounts,
    symbols: raw.symbols,
    transactions: raw.transactions,
    cashflows: raw.cashflows,
    dividends: raw.dividends,
    positionBasis: raw.positionBasis,
    principalKrw: raw.snapshots.at(-1)?.principalKrw,
    quotes: raw.quotes,
    fx: raw.fx,
    fxRateAt,
  });

  return { ...raw, ...portfolio, fxRateAt };
});

export const loadAccountSummary = cache(async () => {
  const { accounts, holdings } = await loadPortfolio();
  return summarizeAccounts(accounts, holdings);
});

export const loadAssetMap = cache(async () => {
  const { holdings, symbols, lookthrough } = await loadPortfolio();
  const expanded = expandHoldings(holdings, symbols, lookthrough);
  return { ...expanded, sectors: groupBySector(expanded.nodes) };
});

export const loadDividendSummary = cache(async () => {
  const { dividends, symbols, holdings, fx } = await loadPortfolio();
  return summarizeDividends(dividends, symbols, holdings, fx);
});

/** 최근 매매 내역. 대시보드 하단에서 쓴다. */
export const loadRecentTrades = cache(async (limit = 6) => {
  const { transactions, symbols, accounts } = await loadPortfolio();
  const symbolById = new Map(symbols.map((s) => [s.id, s]));
  const accountById = new Map(accounts.map((a) => [a.id, a]));
  return [...transactions]
    .filter((tx) => (tx.action ?? "trade") === "trade")
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, limit)
    .map((tx) => ({
      ...tx,
      symbolName: symbolById.get(tx.symbolId)?.name ?? tx.symbolId,
      currency: symbolById.get(tx.symbolId)?.currency ?? "KRW",
      accountName: accountById.get(tx.accountId)?.name ?? tx.accountId,
      amount: tx.shares * tx.price,
    }));
});

/** 평가금액 차트의 매수·매도 타점. 이체와 액면분할은 제외한다. */
export const loadChartTrades = cache(async () => {
  const { transactions, symbols, fxRateAt } = await loadPortfolio();
  const symbolById = new Map(symbols.map((s) => [s.id, s]));
  // annotateTradesWithRealized는 이체·분할을 포함한 전체 원장을 넣어야 평단이
  // 정확하다 — 여기서 미리 걸러내면 그 뒤의 매도 실현손익이 틀어진다.
  const realizedById = new Map(annotateTradesWithRealized(transactions).map((a) => [a.id, a.realized]));

  return transactions
    .filter((tx) => (tx.action ?? "trade") === "trade")
    .sort((a, b) => a.at.localeCompare(b.at))
    .map(({ id, at, side, symbolId, shares, price }) => {
      const currency = symbolById.get(symbolId)?.currency ?? "KRW";
      const realized = realizedById.get(id) ?? 0;
      const realizedKrw = currency === "USD" ? realized * fxRateAt(at) : realized;
      return { at, side, symbolId, shares, price, realizedKrw };
    });
});

/** 최근 입출금 내역. */
export const loadRecentCashFlows = cache(async (limit = 5) => {
  const { cashflows, accounts } = await loadPortfolio();
  const accountById = new Map(accounts.map((a) => [a.id, a]));
  return [...cashflows]
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, limit)
    .map((cf) => ({ ...cf, accountName: accountById.get(cf.accountId)?.name ?? cf.accountId }));
});

/**
 * 백테스트 실행. 시나리오는 정의만 저장해 두고 결과는 매번 계산한다.
 * 가격 이력이 갱신되면 결과도 따라 갱신된다.
 */
export const loadBacktests = cache(async () => {
  const [configs, prices, totalReturnPrices, fxHistory, symbols] = await Promise.all([
    getBacktestConfigs(),
    getPriceHistory(),
    getTotalReturnPriceHistory(),
    getFxHistory(),
    getSymbols(),
  ]);
  return configs.map((config) => runBacktest(config, prices, fxHistory, symbols, totalReturnPrices));
});

export const loadBacktest = cache(async (id: string) => {
  const results = await loadBacktests();
  return results.find((result) => result.config.id === id) ?? null;
});

/** 종목 상세용 가격 이력. */
export const loadPriceHistory = cache(async (symbolId: string) => {
  const history = await getPriceHistory();
  return history[symbolId] ?? [];
});

/** 종목 상세 화면에 필요한 것들을 한 번에 모은다. */
export const loadSymbolDetail = cache(async (symbolId: string) => {
  const portfolio = await loadPortfolio();
  const symbol = portfolio.symbols.find((s) => s.id === symbolId);
  if (!symbol) return null;

  const accountById = new Map(portfolio.accounts.map((a) => [a.id, a]));
  const holding = portfolio.holdings.find((h) => h.symbolId === symbolId) ?? null;
  const history = await loadPriceHistory(symbolId);

  // 이 종목의 이체·분할을 포함한 전체 거래(다른 종목은 계산에 안 섞인다 —
  // annotateTradesWithRealized는 계좌×종목 단위로 따로 추적한다)로 평단을
  // 재생해야 매도 실현손익이 정확하다. 화면(매매 내역·차트 타점)엔 일반
  // 매매만 보여준다.
  const symbolTransactions = portfolio.transactions.filter((tx) => tx.symbolId === symbolId);
  const realizedById = new Map(annotateTradesWithRealized(symbolTransactions).map((a) => [a.id, a.realized]));
  const toKrwAt = (amount: number, at: string) => (symbol.currency === "USD" ? amount * portfolio.fxRateAt(at) : amount);

  const trades = symbolTransactions
    .filter((tx) => (tx.action ?? "trade") === "trade")
    .sort((a, b) => b.at.localeCompare(a.at))
    .map((tx) => ({
      ...tx,
      accountName: accountById.get(tx.accountId)?.name ?? tx.accountId,
      realizedKrw: toKrwAt(realizedById.get(tx.id) ?? 0, tx.at),
    }));

  const payments = portfolio.dividends
    .filter((dv) => dv.symbolId === symbolId)
    .sort((a, b) => b.at.localeCompare(a.at))
    .map((dv) => ({ ...dv, accountName: accountById.get(dv.accountId)?.name ?? dv.accountId }));

  const constituents = symbol.lookthroughId ? (portfolio.lookthrough[symbol.lookthroughId] ?? []) : [];

  const positions = portfolio.positions
    .filter((p) => p.symbolId === symbolId && p.shares > 0)
    .map((p) => ({ ...p, accountName: accountById.get(p.accountId)?.name ?? p.accountId }));

  return { symbol, holding, history, trades, payments, constituents, positions, fx: portfolio.fx };
});

/**
 * 티커 스트립과 표에 들어갈 짧은 추세선 데이터.
 * 종목마다 마지막 N개 종가만 떼어 보낸다.
 */
export const loadSparklines = cache(async (points = 30) => {
  const history = await getPriceHistory();
  const result: Record<string, number[]> = {};
  for (const [symbolId, series] of Object.entries(history)) {
    result[symbolId] = series.slice(-points).map((p) => p.c);
  }
  return result;
});

/**
 * 나스닥100 실효 노출 — 지금과 1주 전·4주 전.
 *
 * 과거 시점은 스냅샷에 종목별 구성이 없어서 그때까지의 거래를 다시 돌려
 * 계산한다(`qqqExposureAt`). 분모가 되는 계좌 전체 금액만은 추정하지 않고
 * 그 시점 스냅샷의 실제 예탁자산을 쓴다.
 */
export const loadQqqExposure = cache(async () => {
  const [{ holdings, totals, transactions, symbols, snapshots, fxHistory, fx }, priceHistory] = await Promise.all([
    loadPortfolio(),
    getPriceHistory(),
  ]);

  const currencyById = new Map(symbols.map((symbol) => [symbol.id, symbol.currency]));
  const currencyOf = (symbolId: string) => currencyById.get(symbolId) ?? "USD";

  const current = summarizeQqqExposure(
    fx.asOf,
    totals.totalKrw,
    holdings.map((holding) => ({ symbolId: holding.symbolId, valueKrw: holding.valueKrw })),
  );

  const latestAt = snapshots.at(-1)?.at ?? fx.asOf;
  const past = [
    { label: "1주 전", days: 7 },
    { label: "4주 전", days: 28 },
  ].flatMap(({ label, days }) => {
    const cutoff = new Date(Date.parse(latestAt) - days * 86_400_000).toISOString();
    const snapshot = [...snapshots].reverse().find((s) => new Date(s.at).toISOString() <= cutoff);
    if (!snapshot) return [];
    return [
      {
        label,
        summary: qqqExposureAt({
          at: snapshot.at,
          transactions,
          priceHistory,
          fxHistory,
          totalKrw: snapshot.totalKrw,
          currencyOf,
        }),
      },
    ];
  });

  return { current, past };
});

/**
 * 주간 리포트가 쓸 재료 전부 — 실효 노출·성격별 구성·종목별·시계열 사실을
 * 같은 시점 기준으로 묶는다. 과거 시점은 거래를 다시 돌려 재구성하되, 비중의
 * 분모는 그날 스냅샷의 실제 예탁자산을 쓴다(`positionValuesAsOf` 주석 참고).
 */
export const loadWeeklyReportInput = cache(async () => {
  const [{ holdings, totals, transactions, symbols, snapshots, fxHistory, fx }, priceHistory] = await Promise.all([
    loadPortfolio(),
    getPriceHistory(),
  ]);

  const symbolById = new Map(symbols.map((symbol) => [symbol.id, symbol]));
  const currencyOf = (symbolId: string) => symbolById.get(symbolId)?.currency ?? "USD";
  const kindOf = (symbolId: string) => symbolById.get(symbolId)?.kind ?? "stock";

  const currentEntries = holdings.map((holding) => ({
    symbolId: holding.symbolId,
    kind: holding.kind,
    valueKrw: holding.valueKrw,
  }));

  const current: PointInTime = {
    label: "현재",
    at: fx.asOf,
    totalKrw: totals.totalKrw,
    exposure: summarizeQqqExposure(fx.asOf, totals.totalKrw, currentEntries),
    themes: summarizeComposition(currentEntries, totals.totalKrw),
    unexplainedPercent: unexplainedPercent(currentEntries, totals.totalKrw),
  };

  const latestAt = snapshots.at(-1)?.at ?? fx.asOf;
  const past = [
    { label: "1주 전", days: 7 },
    { label: "4주 전", days: 28 },
  ].flatMap(({ label, days }) => {
    const cutoff = new Date(Date.parse(latestAt) - days * 86_400_000).toISOString();
    const snapshot = [...snapshots].reverse().find((s) => new Date(s.at).toISOString() <= cutoff);
    if (!snapshot) return [];

    const values = positionValuesAsOf({ at: snapshot.at, transactions, priceHistory, fxHistory, currencyOf });
    const entries = values.map((value) => ({ ...value, kind: kindOf(value.symbolId) }));
    return [
      {
        label,
        at: snapshot.at,
        totalKrw: snapshot.totalKrw,
        exposure: summarizeQqqExposure(snapshot.at, snapshot.totalKrw, values),
        themes: summarizeComposition(entries, snapshot.totalKrw),
        unexplainedPercent: unexplainedPercent(values, snapshot.totalKrw),
      } satisfies PointInTime,
    ];
  });

  // 전체 기간으로 잡으면 계좌를 막 열어 잔고가 거의 0이던 첫 주 때문에 최대낙폭이
  // -99%로 나온다 — 주간 점검에서 볼 숫자가 아니라, 대시보드 기본값과 같은 1년으로 본다.
  const yearSnapshots = filterSnapshots(snapshots, "1y").snapshots;
  const stats = analyzeSeries(yearSnapshots);
  const performanceDrawdown = cashflowAdjustedDrawdown(yearSnapshots);

  return {
    at: new Date().toISOString(),
    current,
    past,
    holdings: [...holdings]
      .filter((holding) => holding.kind !== "cash")
      .sort((a, b) => b.valueKrw - a.valueKrw)
      .map((holding) => ({
        symbolId: holding.symbolId,
        name: holding.name,
        shares: holding.shares,
        valueKrw: holding.valueKrw,
        weightPercent: holding.weight,
        totalGainPercent: holding.totalGainPercent,
        totalGainKrw: holding.totalGainKrw,
      })),
    facts: {
      vsPeakPercent: stats.vsPeakPercent,
      maxDrawdown: stats.maxDrawdown,
      performanceMaxDrawdown: performanceDrawdown.maxDrawdown,
      peakAt: stats.peak?.at ?? null,
      principalKrw: totals.principalKrw,
      principalGainPercent: totals.principalGainPercent,
    },
  };
});
