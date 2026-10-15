import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import { writeJsonAtomic, withDataLock } from "./atomic-write.mjs";
import { publicJson } from "./calendar-refresh.mjs";

/**
 * 보유 종목의 다음 실적 발표일을 나스닥 공개 실적 캘린더에서 찾아 `calendar.json`에
 * 일정으로 넣는다. SEC 기업번호(CIK)도 같이 붙여 두면, 기존 캘린더 수집이 발표 뒤
 * 공시(10-Q 등)가 올라오는 대로 매출·EPS 결과를 채운다.
 *
 * 나스닥 캘린더는 날짜별 목록만 주므로 앞으로 DAYS_AHEAD일을 하루씩 훑는다.
 */

const DAYS_AHEAD = 90;
const MONTHS = { Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06", Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12" };
const TIME_LABEL = { "time-pre-market": "미국 장 시작 전", "time-after-hours": "미국 장 마감 후" };

/** "Sep/2026" → "2026-09" */
export function fiscalPeriod(text) {
  const match = /^([A-Z][a-z]{2})\/(\d{4})$/.exec(text ?? "");
  return match && MONTHS[match[1]] ? `${match[2]}-${MONTHS[match[1]]}` : null;
}

/**
 * 찾은 발표 일정을 기존 일정에 합친다. 자동으로 넣은 일정(`earn-` id)은 날짜가 바뀌면
 * 고쳐 쓰고, 사람이 직접 넣은 같은 종목·같은 분기 실적 일정이 있으면 건드리지 않는다.
 */
export function mergeEarnings(events, found, ciks) {
  const next = [...events];
  for (const row of found) {
    const period = fiscalPeriod(row.fiscalQuarterEnding);
    if (!period) continue;
    const manual = next.some(
      (e) => e.kind === "earnings" && e.symbolId === row.symbol && !e.id.startsWith("earn-") && e.resultSource?.period === period,
    );
    if (manual) continue;
    const id = `earn-${row.symbol}-${period}`;
    const cik = ciks[row.symbol];
    const note = [TIME_LABEL[row.time], row.epsForecast ? `예상 EPS ${row.epsForecast}` : null].filter(Boolean).join(" · ");
    const event = {
      id,
      date: row.date,
      title: `${row.symbol} 실적 발표`,
      kind: "earnings",
      symbolId: row.symbol,
      ...(note ? { note } : {}),
      ...(cik ? { resultSource: { provider: "sec", period, cik } } : {}),
    };
    const at = next.findIndex((e) => e.id === id);
    if (at === -1) next.push(event);
    else next[at] = event;
  }
  return next.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
}

function weekdaysFrom(start, days) {
  const out = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(Date.parse(`${start}T00:00:00Z`) + i * 86_400_000);
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));

// 나스닥은 Node 기본 https 요청을 연결 단계에서 끊는다(ECONNRESET) — 브라우저와 같은
// 헤더를 붙인 fetch는 받아 준다.
async function nasdaqJson(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)", Accept: "application/json, text/plain, */*", "Accept-Language": "en-US,en;q=0.9" },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`나스닥 실적 캘린더 HTTP ${res.status}`);
  return res.json();
}

export async function syncEarnings({ dataDir = join(process.cwd(), "data"), now = new Date(), fetchNasdaq = nasdaqJson, fetchJson = publicJson, throttleMs = 300 } = {}) {
  const symbols = readJson(join(dataDir, "symbols.json"));
  const basis = readJson(join(dataDir, "position-basis.json"));
  const stockIds = new Set(symbols.filter((s) => s.kind === "stock" && s.market === "US").map((s) => s.id));
  const held = new Set(basis.filter((p) => p.shares > 0 && stockIds.has(p.symbolId)).map((p) => p.symbolId));
  if (held.size === 0) return { found: 0, added: 0 };

  const found = [];
  for (const date of weekdaysFrom(now.toISOString().slice(0, 10), DAYS_AHEAD)) {
    const payload = await fetchNasdaq(`https://api.nasdaq.com/api/calendar/earnings?date=${date}`);
    for (const row of payload?.data?.rows ?? []) {
      if (held.has(row.symbol)) found.push({ ...row, date });
    }
    await sleep(throttleMs);
  }

  const tickers = await fetchJson("https://www.sec.gov/files/company_tickers.json", { userAgent: process.env.SEC_USER_AGENT });
  const ciks = {};
  for (const entry of Object.values(tickers ?? {})) {
    if (held.has(entry.ticker)) ciks[entry.ticker] = String(entry.cik_str).padStart(10, "0");
  }

  let added = 0;
  withDataLock(dataDir, () => {
    const path = join(dataDir, "calendar.json");
    const before = readJson(path);
    const after = mergeEarnings(before, found, ciks);
    added = after.length - before.length;
    writeJsonAtomic(path, `${JSON.stringify(after, null, 2)}\n`);
  });
  return { found: found.length, added };
}

/**
 * 하루 한 번만 `syncEarnings`를 돌린다(나스닥을 90일치 하루씩 훑으므로 6시간마다는 과하다).
 * 마지막으로 성공한 날짜를 `data/.earnings-sync-date`에 남긴다.
 */
export async function syncEarningsDaily({ dataDir = join(process.cwd(), "data"), now = new Date(), force = false } = {}) {
  const stampPath = join(dataDir, ".earnings-sync-date");
  const today = now.toISOString().slice(0, 10);
  let last = "";
  try {
    last = readFileSync(stampPath, "utf8").trim();
  } catch {}
  if (last === today && !force) return null;
  const result = await syncEarnings({ dataDir, now });
  writeFileSync(stampPath, today);
  return result;
}
