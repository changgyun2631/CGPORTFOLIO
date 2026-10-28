import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import { writeJsonAtomic, withDataLock } from "./atomic-write.mjs";
import { syncLogos } from "./logo-sync.mjs";

/**
 * earningswhispers.com "가장 기대되는 실적" 주간 페이지(/calweek/YYYYMMDD)에서 주요 기업의
 * 발표일을 읽어 `calendar.json`에 일정으로 넣는다. 공개 API가 없어 서버가 그린 HTML의
 * `data-symbols`(칸당 최대 10개)를 읽는다. 일정 id는 `ew-{티커}-{날짜}`이고 결과 수집(SEC)은 붙이지 않는다.
 */

const WEEKS_AHEAD = 4;
const NOTE = { bo: "미국 장 시작 전", ac: "미국 장 마감 후" };
const day = (ms) => new Date(ms).toISOString().slice(0, 10);

/** 날짜가 속한 주의 월요일 (YYYY-MM-DD) */
export function mondayOf(date) {
  const ms = Date.parse(`${date}T00:00:00Z`);
  return day(ms - ((new Date(ms).getUTCDay() + 6) % 7) * 86_400_000);
}

/**
 * 주간 페이지 HTML → [{ symbol, date, time }]. 요일 5칸 × (장전, 장후) 순서이며
 * 칸 순서가 곧 기대도 순위다. 모바일용 중복 마크업은 요일마다 앞 두 칸만 읽어 건너뛴다.
 */
export function parseWeek(html, monday) {
  const rows = [];
  const groups = html.split('cw-daycol cw-logogroup').slice(1, 6);
  groups.forEach((group, i) => {
    const date = day(Date.parse(`${monday}T00:00:00Z`) + i * 86_400_000);
    const cells = group.match(/<[a-z]+[^>]*class="cw-cell[^"]*"[^>]*>/g)?.slice(0, 2) ?? [];
    cells.forEach((tag, j) => {
      const symbols = /data-symbols="([^"]*)"/.exec(tag)?.[1] ?? "";
      for (const symbol of symbols.split(",").filter(Boolean)) rows.push({ symbol, date, time: j === 0 ? "bo" : "ac" });
    });
  });
  return rows;
}

/**
 * 찾은 일정을 합친다. 아직 오지 않은 `ew-` 일정은 가져온 기간 안에서 목록과 맞춰 고치고(사라진 것은 삭제),
 * 지난 일정은 그대로 둔다. 같은 종목·같은 날짜의 다른 실적 일정(보유 종목 등)이 있으면 넣지 않는다.
 */
export function mergeEw(events, found, { today, until }) {
  const keep = events.filter((e) => !(e.id.startsWith("ew-") && e.date >= today && e.date <= until));
  const next = [...keep];
  for (const row of found) {
    if (next.some((e) => e.kind === "earnings" && e.symbolId === row.symbol && e.date === row.date && !e.id.startsWith("ew-"))) continue;
    next.push({ id: `ew-${row.symbol}-${row.date}`, date: row.date, title: `${row.symbol} 실적 발표`, kind: "earnings", symbolId: row.symbol, note: NOTE[row.time] });
  }
  return next.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
}

async function fetchHtml(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)", Accept: "text/html", "Accept-Language": "en-US,en;q=0.9" },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`Earnings Whispers HTTP ${res.status}`);
  return res.text();
}

export async function syncEw({ dataDir = join(process.cwd(), "data"), now = new Date(), fetchPage = fetchHtml, throttleMs = 500 } = {}) {
  const today = now.toISOString().slice(0, 10);
  let monday = mondayOf(today);
  const found = [];
  let until = null;
  for (let i = 0; i < WEEKS_AHEAD; i++) {
    const rows = parseWeek(await fetchPage(`https://www.earningswhispers.com/calweek/${monday.replaceAll("-", "")}`), monday);
    if (rows.length === 0) break; // 아직 목록이 없는 먼 주
    found.push(...rows);
    until = day(Date.parse(`${monday}T00:00:00Z`) + 6 * 86_400_000);
    monday = day(Date.parse(`${monday}T00:00:00Z`) + 7 * 86_400_000);
    await sleep(throttleMs);
  }
  if (!until) return { found: 0, added: 0 }; // 한 주도 못 읽었으면 기존 일정을 지우지 않는다

  let added = 0;
  withDataLock(dataDir, () => {
    const path = join(dataDir, "calendar.json");
    const before = JSON.parse(readFileSync(path, "utf8"));
    const after = mergeEw(before, found, { today, until });
    added = after.length - before.length;
    writeJsonAtomic(path, `${JSON.stringify(after, null, 2)}\n`);
  });
  return { found: found.length, added };
}

/** 캘린더에 올라온 앞으로의 실적 종목 로고를 `limit`개까지 받아 둔다. 실패해도 일정에는 영향이 없다. */
export function syncCalendarLogos({ dataDir = join(process.cwd(), "data"), now = new Date(), limit } = {}) {
  const events = JSON.parse(readFileSync(join(dataDir, "calendar.json"), "utf8"));
  return syncLogos(upcomingSymbols(events, now.toISOString().slice(0, 10)), { dataDir, limit });
}

/** 앞으로 올 실적 일정의 티커를 가까운 날짜 순으로 — 로고를 먼저 받을 순서. */
export function upcomingSymbols(events, today) {
  const seen = new Set();
  return events
    .filter((e) => e.kind === "earnings" && e.symbolId && e.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((e) => e.symbolId)
    .filter((s) => !seen.has(s) && seen.add(s));
}

/** 하루 한 번만 돌린다. 마지막 성공 날짜는 `data/.ew-sync-date`. */
export async function syncEwDaily({ dataDir = join(process.cwd(), "data"), now = new Date(), force = false } = {}) {
  const stampPath = join(dataDir, ".ew-sync-date");
  const today = now.toISOString().slice(0, 10);
  let last = "";
  try {
    last = readFileSync(stampPath, "utf8").trim();
  } catch {}
  if (last === today && !force) return null;
  const result = await syncEw({ dataDir, now });
  writeFileSync(stampPath, today);
  return result;
}
