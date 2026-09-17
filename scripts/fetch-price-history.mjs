/**
 * 보유 US 종목의 실제 장기 종가를 Twelve Data `time_series`에서 받아와
 * `data/prices.json`을 채운다. `scripts/seed.mjs`가 만든 가상 난수 데이터를
 * 실제 값으로 대체한다(WORK_ORDER B-4).
 *
 * `time_series`도 시세 조회와 같은 크레딧 무게(심볼당 1크레딧)를 쓰므로
 * `lib/providers/twelve-data.ts`와 같은 분당 8개 배치·61초 대기 규칙을 그대로
 * 따른다. `outputsize=5000`은 이 플랜에서 실제로 QLD 기준 2006-10-27까지
 * 돌려준다(2008 금융위기 구간 포함, WORK_ORDER B-4 요구사항) — 심볼마다 상장일이
 * 다르면 그만큼 짧게 온다.
 *
 * 국내 종목(KR)은 이 스크립트 범위 밖이다 — Twelve Data는 국내 상장 ETF를
 * 안 다루고(`lib/providers/naver-kr.ts` 주석 참고), 네이버 쪽엔 과거 일별
 * 종가를 주는 별도 엔드포인트가 없다. 현재 보유 종목 중 국내는 1개뿐이고,
 * 가격 이력이 없는 종목은 화면에서 조용히 섹션이 사라지는 대신 안내 문구로
 * 이미 처리돼 있다.
 *
 * 기본은 검토용 `data/out-prices.json`만 쓴다. `--replace`를 붙여야 실제
 * `data/prices.json`을 교체한다(적용 직전 자동 백업).
 *
 *   node scripts/fetch-price-history.mjs [--replace] [--symbols=QLD,SCHD]
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { withDataLock, writeJsonAtomic } from "./lib/atomic-write.mjs";
import { backupData } from "./lib/backup.mjs";
import { mergePriceHistory, parseTimeSeriesResponse } from "./lib/price-history.mjs";
import { loadLocalEnv } from "./lib/load-local-env.mjs";

// 예약 실행은 셸을 거치지 않으므로 .env.local을 직접 읽어야 API 키가 채워진다.
loadLocalEnv();

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = join(root, "data");
const backupRoot = join(homedir(), "cgportfolio-backups");

const MAX_SYMBOLS_PER_MINUTE = 8;
const CHUNK_WAIT_MS = 61_000;
const OUTPUT_SIZE = 5000;
const REQUEST_TIMEOUT_MS = 20_000;

function parseArgs(argv) {
  const flags = {};
  for (const arg of argv) {
    if (!arg.startsWith("--")) continue;
    const [key, ...rest] = arg.slice(2).split("=");
    flags[key] = rest.length > 0 ? rest.join("=") : true;
  }
  return flags;
}

function chunk(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchOne(symbolId, apiKey) {
  const url = new URL("https://api.twelvedata.com/time_series");
  url.searchParams.set("symbol", symbolId);
  url.searchParams.set("interval", "1day");
  url.searchParams.set("outputsize", String(OUTPUT_SIZE));
  url.searchParams.set("apikey", apiKey);

  const response = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const body = await response.json();
  return parseTimeSeriesResponse(symbolId, body);
}

/**
 * 분당 한도(429)는 같은 API 키를 쓰는 시세 갱신과 겹칠 때 흔히 난다. 한 박자
 * 쉬고 한 번만 더 해본다 — 그래도 안 되면 실패로 넘긴다. 다음 날 실행이
 * 어차피 전체 이력을 다시 받아오므로, 하루 빠진 종목은 저절로 메워진다.
 */
async function fetchWithRetry(symbolId, apiKey) {
  try {
    return await fetchOne(symbolId, apiKey);
  } catch (error) {
    if (!/429/.test(error.message)) throw error;
    console.warn(`${symbolId}: 분당 한도(429) — 61초 쉬고 한 번 더 시도합니다.`);
    await sleep(CHUNK_WAIT_MS);
    return fetchOne(symbolId, apiKey);
  }
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  const apiKey = process.env.TWELVE_DATA_API_KEY;
  if (!apiKey) throw new Error("TWELVE_DATA_API_KEY가 없습니다. .env.local을 확인하세요.");

  const symbols = JSON.parse(readFileSync(join(dataDir, "symbols.json"), "utf8"));
  const wanted = flags.symbols
    ? String(flags.symbols)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : symbols.filter((s) => s.market === "US").map((s) => s.id);

  if (wanted.length === 0) {
    console.log("대상 종목이 없습니다.");
    return;
  }

  let existing = {};
  try {
    existing = JSON.parse(readFileSync(join(dataDir, "prices.json"), "utf8"));
  } catch {
    // 처음 실행이라면 없을 수 있다 — 빈 값에서 시작.
  }

  const fetched = {};
  const failures = [];
  const groups = chunk(wanted, MAX_SYMBOLS_PER_MINUTE);

  for (const [index, group] of groups.entries()) {
    if (index > 0) {
      console.log(`분당 한도 대기 중(61초)... (${index * MAX_SYMBOLS_PER_MINUTE}/${wanted.length}종목 처리함)`);
      await sleep(CHUNK_WAIT_MS);
    }
    for (const symbolId of group) {
      try {
        const series = await fetchWithRetry(symbolId, apiKey);
        fetched[symbolId] = series;
        console.log(`${symbolId}: ${series.length}일 확보 (${series[0].d} ~ ${series.at(-1).d})`);
      } catch (error) {
        failures.push({ symbolId, message: error.message });
        console.warn(`${symbolId} 실패: ${error.message}`);
      }
    }
  }

  const merged = mergePriceHistory(existing, fetched);
  const target = join(dataDir, flags.replace ? "prices.json" : "out-prices.json");
  const write = () => writeJsonAtomic(target, `${JSON.stringify(merged, null, 2)}\n`);

  if (flags.replace) {
    // 처음 한 번 채워 넣을 때는 반쯤 채워진 파일이 남지 않도록 전부 성공해야 반영한다.
    // 반대로 매일 도는 갱신은 한 종목이 흔들렸다고 나머지 61종목의 하루를 버리면
    // 안 된다 — 병합이 종목 단위라 성공한 것만 반영해도 나머지는 그대로 남고,
    // 빠진 종목은 다음 날 실행이 전체 이력을 다시 받아오며 메운다.
    if (failures.length > 0 && !flags["allow-partial"]) {
      console.error(
        `${failures.length}개 종목 실패 — 반영을 중단합니다: ${failures.map((f) => f.symbolId).join(", ")}. ` +
          "실패한 종목만 --symbols로 다시 시도하거나, 전부 성공할 때까지 --replace 없이 재실행하세요.",
      );
      process.exit(1);
    }
    if (failures.length === wanted.length) {
      console.error("전 종목 실패 — 반영할 것이 없습니다.");
      process.exit(1);
    }
    if (failures.length > 0) {
      console.warn(`${failures.length}개 종목은 이번에 건너뜀(다음 실행에서 메워짐): ${failures.map((f) => f.symbolId).join(", ")}`);
    }
    backupData(dataDir, backupRoot);
    withDataLock(dataDir, write);
  } else {
    write();
  }

  console.log(`${wanted.length - failures.length}/${wanted.length}종목 완료. ${target}에 저장했습니다.`);
  if (!flags.replace) console.log("검토 후 --replace를 붙이면 실제 data/prices.json으로 반영됩니다.");
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
