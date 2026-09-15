import "server-only";

import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { cache } from "react";

import type { BacktestConfig } from "@/lib/domain/backtest";
import type {
  Account,
  CalendarEvent,
  CashFlow,
  DividendPayment,
  FxRate,
  LookthroughTable,
  Quote,
  ReportMeta,
  Snapshot,
  Symbol,
  Transaction,
} from "@/lib/domain/types";

/**
 * 읽기 전용 저장소.
 *
 * 지금은 data/*.json 이 원본이다. Supabase나 Postgres로 옮길 때
 * 이 파일의 함수 본문만 쿼리로 바꾸면 되고, 나머지 코드는 손대지 않는다.
 */

const dataDir = join(process.cwd(), "data");

/**
 * 요청 한 번 안에서만 같은 파일을 재사용한다.
 *
 * 모듈 수준 Map에 담아두면 프로세스가 사는 동안 영원히 남아서, cron이 파일을
 * 새로 써도 화면은 낡은 값을 계속 보여준다. React cache는 요청 경계에서
 * 비워지므로 중복 읽기는 막으면서 갱신은 바로 반영된다.
 */
const readJsonCached = cache(async (name: string): Promise<unknown> => {
  try {
    return JSON.parse(await readFile(join(dataDir, name), "utf8"));
  } catch (error) {
    throw new Error(`data/${name} 을 읽지 못했습니다: ${(error as Error).message}`);
  }
});

function readJson<T>(name: string): Promise<T> {
  return readJsonCached(name) as Promise<T>;
}

export const getAccounts = () => readJson<Account[]>("accounts.json");
export const getSymbols = () => readJson<Symbol[]>("symbols.json");
export const getTransactions = () => readJson<Transaction[]>("transactions.json");
export const getCashFlows = () => readJson<CashFlow[]>("cashflows.json");
export const getDividends = () => readJson<DividendPayment[]>("dividends.json");
export const getSnapshots = () => readJson<Snapshot[]>("snapshots.json");
export const getQuotes = () => readJson<Quote[]>("quotes.json");
export const getFxQuote = () => readJson<FxRate>("fx-quote.json");
export const getLookthrough = () => readJson<LookthroughTable>("lookthrough.json");
export const getPriceHistory = () => readJson<Record<string, { d: string; c: number }[]>>("prices.json");
export const getFxHistory = () => readJson<{ d: string; rate: number }[]>("fx.json");

export async function getBacktestConfigs(): Promise<BacktestConfig[]> {
  try {
    return await readJson<BacktestConfig[]>("backtests.json");
  } catch {
    return [];
  }
}

/** 투자철학 본문. 없으면 null 을 돌려 화면에서 안내로 대체한다. */
export async function getPhilosophy(): Promise<string | null> {
  try {
    return await readFile(join(dataDir, "philosophy.md"), "utf8");
  } catch {
    return null;
  }
}

export async function getCalendarEvents(): Promise<CalendarEvent[]> {
  try {
    return await readJson<CalendarEvent[]>("calendar.json");
  } catch {
    return [];
  }
}

export async function getReports(): Promise<ReportMeta[]> {
  try {
    const reports = await readJson<ReportMeta[]>("reports.json");
    return [...reports].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  } catch {
    return [];
  }
}

export async function getReportBody(slug: string): Promise<string | null> {
  // 슬러그가 경로를 벗어나지 못하게 막는다.
  if (!/^[a-z0-9-]+$/i.test(slug)) return null;
  try {
    return await readFile(join(dataDir, "reports", `${slug}.md`), "utf8");
  } catch {
    return null;
  }
}
