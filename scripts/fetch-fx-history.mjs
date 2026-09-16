/**
 * 실제 과거 USD/KRW 환율을 Twelve Data `time_series`에서 받아 `data/fx.json`을
 * 채운다. `scripts/seed.mjs`가 만든 가상 데이터를 대체한다 — `prices.json`을
 * 실제 종가로 바꾼 것과 같은 이유(WORK_ORDER B-4), 이번엔 환율 쪽.
 *
 * 2026-09-16 사용자가 "차트 환율이 이상하다"고 지적해서 확인해 보니, 실제로
 * `fx.json`이 2024-01-02부터의 매끈한 난수였다 — 2026-07-02에 실제로는
 * 1,550원대까지 갔었는데(서울외국환중개 공식 매매기준율로 확인, Twelve
 * Data도 그날 종가 1,539.79/고가 1,556.58로 일치) `fx.json`은 그날 1,352원
 * 근처를 보여주고 있었다.
 *
 * 이 파일을 고친 뒤에는 `scripts/fix-snapshot-fx.mjs`로 이미 저장된
 * `data/snapshots.json`의 fxRate도 다시 채워야 한다 — 계좌수익률 CSV로 만든
 * 과거 스냅샷은 fxRate를 이 파일에서 날짜별로 가져왔기 때문이다.
 *
 * 기본은 검토용 `data/out-fx.json`만 쓴다. `--replace`를 붙여야 실제
 * `data/fx.json`을 교체한다(적용 직전 자동 백업).
 *
 *   node scripts/fetch-fx-history.mjs [--replace]
 */
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { withDataLock, writeJsonAtomic } from "./lib/atomic-write.mjs";
import { backupData } from "./lib/backup.mjs";
import { parseTimeSeriesResponse } from "./lib/price-history.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = join(root, "data");
const backupRoot = join(homedir(), "cgportfolio-backups");

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

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  const apiKey = process.env.TWELVE_DATA_API_KEY;
  if (!apiKey) throw new Error("TWELVE_DATA_API_KEY가 없습니다. .env.local을 확인하세요.");

  const url = new URL("https://api.twelvedata.com/time_series");
  url.searchParams.set("symbol", "USD/KRW");
  url.searchParams.set("interval", "1day");
  url.searchParams.set("outputsize", String(OUTPUT_SIZE));
  url.searchParams.set("apikey", apiKey);

  const response = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const body = await response.json();
  // time_series 응답 모양(datetime/close)은 종목 시세와 같아서 같은 파서를 쓴다 —
  // 필드 이름(c -> rate)만 fx.json 저장 형식에 맞게 바꾼다.
  const series = parseTimeSeriesResponse("USD/KRW", body);
  const fxHistory = series.map(({ d, c }) => ({ d, rate: c }));

  console.log(`USD/KRW: ${fxHistory.length}일 확보 (${fxHistory[0].d} ~ ${fxHistory.at(-1).d})`);

  const target = join(dataDir, flags.replace ? "fx.json" : "out-fx.json");
  const write = () => writeJsonAtomic(target, `${JSON.stringify(fxHistory, null, 2)}\n`);

  if (flags.replace) {
    backupData(dataDir, backupRoot);
    withDataLock(dataDir, write);
  } else {
    write();
  }

  console.log(`${target}에 저장했습니다.`);
  if (!flags.replace) {
    console.log("검토 후 --replace를 붙이면 실제 data/fx.json으로 반영됩니다.");
    console.log("반영 후에는 node scripts/fix-snapshot-fx.mjs --replace도 돌릴 것 — 이미 저장된 스냅샷의 fxRate를 다시 채운다.");
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
