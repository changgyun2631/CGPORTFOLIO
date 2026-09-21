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
  PositionBasis,
  Quote,
  ReportMeta,
  Snapshot,
  Symbol,
  Transaction,
} from "@/lib/domain/types";
import type { GeneratedReport } from "@/lib/domain/weekly-report";
import type { CalendarResults } from "@/lib/domain/calendar-results";

/**
 * 읽기 전용 저장소.
 *
 * 지금은 data/*.json 이 원본이다. Supabase나 Postgres로 옮길 때
 * 이 파일의 함수 본문만 쿼리로 바꾸면 되고, 나머지 코드는 손대지 않는다.
 */

const dataDir = join(process.cwd(), "data");

async function readJsonRaw(name: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(join(dataDir, name), "utf8"));
  } catch (error) {
    // 개인 데이터 파일은 저장소에 없다. 처음 받아서 실행한 경우가 대부분이므로 다음 할 일을 알려준다.
    const missing = (error as NodeJS.ErrnoException).code === "ENOENT";
    const hint = missing ? " 개인 데이터는 저장소에 없습니다. `node scripts/seed.mjs` 를 먼저 실행하세요." : "";
    throw new Error(`data/${name} 을 읽지 못했습니다.${hint} (${(error as Error).message})`);
  }
}

/**
 * 요청 한 번 안에서만 같은 파일을 재사용한다.
 *
 * 모듈 수준 Map에 담아두면 프로세스가 사는 동안 영원히 남아서, cron이 파일을
 * 새로 써도 화면은 낡은 값을 계속 보여준다. React cache는 요청 경계에서
 * 비워지므로 중복 읽기는 막으면서 갱신은 바로 반영된다.
 */
const readJsonCached = cache(readJsonRaw);

function readJson<T>(name: string): Promise<T> {
  return readJsonCached(name) as Promise<T>;
}

/**
 * 캐시를 거치지 않고 지금 이 순간의 파일 내용을 직접 읽는다.
 *
 * cron의 세대 쓰기(`app/api/cron/refresh/route.ts`)처럼, 같은 요청 안에서 이미
 * `loadPortfolio()` 등으로 캐시가 채워진 뒤에도 잠금 안에서 "진짜 지금" 값을 다시
 * 봐야 하는 경로에서만 쓴다(WORK_ORDER B-0A-3) — React `cache()`는 같은 파일을
 * 한 요청 안에서 몇 번을 불러도 첫 결과를 그대로 돌려주므로, 외부 API 호출(느림)이
 * 끝나고 잠금을 잡은 시점에는 그 사이 다른 프로세스가 써 둔 최신 값이 아니라
 * "요청 시작 시점"의 낡은 값을 보게 될 수 있다. 평소 페이지 렌더링에는 쓰지
 * 않는다 — 캐시를 우회하면 같은 요청 안에서 같은 파일을 여러 번 디스크에서 읽게 된다.
 */
export function readJsonUncached<T>(name: string): Promise<T> {
  return readJsonRaw(name) as Promise<T>;
}

export const getAccounts = () => readJson<Account[]>("accounts.json");
export const getSymbols = () => readJson<Symbol[]>("symbols.json");
export const getTransactions = () => readJson<Transaction[]>("transactions.json");
export const getCashFlows = () => readJson<CashFlow[]>("cashflows.json");
export const getDividends = () => readJson<DividendPayment[]>("dividends.json");
export async function getPositionBasis(): Promise<PositionBasis[]> {
  try {
    return await readJson<PositionBasis[]>("position-basis.json");
  } catch {
    return [];
  }
}
export const getSnapshots = () => readJson<Snapshot[]>("snapshots.json");
export const getQuotes = () => readJson<Quote[]>("quotes.json");
export const getFxQuote = () => readJson<FxRate>("fx-quote.json");
export const getLookthrough = () => readJson<LookthroughTable>("lookthrough.json");
export const getPriceHistory = () => readJson<Record<string, { d: string; c: number }[]>>("prices.json");

/**
 * 배당·분할을 반영한 가격. 백테스트만 쓴다 — 화면에 뜨는 종가는 실제 거래가여야
 * 하므로 `prices.json`과 따로 둔다. 아직 한 번도 받지 않았으면 빈 표를 주고,
 * 백테스트는 그때 주가 기준으로 돌면서 배당 기여분을 null로 남긴다.
 */
export async function getTotalReturnPriceHistory(): Promise<Record<string, { d: string; c: number }[]>> {
  try {
    return await readJson<Record<string, { d: string; c: number }[]>>("prices-total-return.json");
  } catch {
    return {};
  }
}
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

/** 공식 원천 수집 결과. 페이지에서는 외부 API를 호출하지 않는다. */
export async function getCalendarResults(): Promise<CalendarResults | null> {
  try {
    const data = await readJson<CalendarResults>("calendar-results.json");
    return data.version === 1 && data.results && typeof data.results === "object" ? data : null;
  } catch {
    return null;
  }
}

/** 예약 실행이 만든 리포트는 실제 비중·평가금액을 포함하므로 gitignore 대상이다. */
export const getGeneratedReports = () =>
  readJson<GeneratedReport[]>("weekly-reports.json").catch(() => [] as GeneratedReport[]);

export async function getReports(): Promise<ReportMeta[]> {
  const [written, generated] = await Promise.all([
    readJson<ReportMeta[]>("reports.json").catch(() => [] as ReportMeta[]),
    getGeneratedReports(),
  ]);
  // 본문은 목록에 필요 없다 — 통째로 넘기면 화면 payload만 커진다.
  const merged: ReportMeta[] = [
    ...written,
    ...generated.map((report) => ({
      slug: report.slug,
      title: report.title,
      summary: report.summary,
      publishedAt: report.publishedAt,
      tags: report.tags,
    })),
  ];
  return merged.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
}

export async function getReportBody(slug: string): Promise<string | null> {
  // 슬러그가 경로를 벗어나지 못하게 막는다.
  if (!/^[a-z0-9-]+$/i.test(slug)) return null;
  try {
    return await readFile(join(dataDir, "reports", `${slug}.md`), "utf8");
  } catch {
    const generated = await getGeneratedReports();
    return generated.find((report) => report.slug === slug)?.body ?? null;
  }
}
