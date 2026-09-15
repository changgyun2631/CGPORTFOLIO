import "server-only";

import { cache } from "react";

import { runBacktest } from "@/lib/domain/backtest";
import { summarizeDividends } from "@/lib/domain/dividends";
import { expandHoldings, groupBySector } from "@/lib/domain/lookthrough";
import { buildPortfolio, summarizeAccounts } from "@/lib/domain/portfolio";

import {
  getAccounts,
  getBacktestConfigs,
  getCashFlows,
  getDividends,
  getFxHistory,
  getFxQuote,
  getLookthrough,
  getPriceHistory,
  getQuotes,
  getSnapshots,
  getSymbols,
  getTransactions,
} from "./store";

/**
 * 페이지가 쓰는 뷰모델을 한 곳에서 조립한다.
 *
 * react cache 로 감싸 두었으므로 한 요청 안에서 여러 컴포넌트가 불러도
 * 계산은 한 번만 돈다.
 */

export const loadRaw = cache(async () => {
  const [accounts, symbols, transactions, cashflows, dividends, quotes, fx, snapshots, lookthrough, fxHistory] = await Promise.all([
    getAccounts(),
    getSymbols(),
    getTransactions(),
    getCashFlows(),
    getDividends(),
    getQuotes(),
    getFxQuote(),
    getSnapshots(),
    getLookthrough(),
    getFxHistory(),
  ]);
  return { accounts, symbols, transactions, cashflows, dividends, quotes, fx, snapshots, lookthrough, fxHistory };
});

/** 과거 환율 조회. 없는 날짜는 그 이전 마지막 값을 쓴다. */
function makeFxLookup(history: { d: string; rate: number }[], fallback: number) {
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
  const [configs, prices, fxHistory, symbols] = await Promise.all([
    getBacktestConfigs(),
    getPriceHistory(),
    getFxHistory(),
    getSymbols(),
  ]);
  return configs.map((config) => runBacktest(config, prices, fxHistory, symbols));
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

  const trades = portfolio.transactions
    .filter((tx) => tx.symbolId === symbolId)
    .sort((a, b) => b.at.localeCompare(a.at))
    .map((tx) => ({ ...tx, accountName: accountById.get(tx.accountId)?.name ?? tx.accountId }));

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
