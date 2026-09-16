/**
 * 계좌수익률 CSV의 일별 예탁자산을 총 평가금액 스냅샷으로 가져온다.
 * 여러 CSV를 주면 동일 날짜의 계좌별 예탁자산을 합산한다.
 *
 * 실제 파싱·병합 로직은 `scripts/lib/import-account-history.mjs`(순수 함수)에
 * 있다 — 웹 가져오기 화면(`lib/import/`)도 같은 함수를 쓴다. 이 파일은 CLI
 * 인자 처리와 파일 IO만 담당하는 얇은 wrapper다.
 *
 * node scripts/import-account-history-csv.mjs <csv...> [--replace]
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { withDataLock, writeJsonAtomic } from "./lib/atomic-write.mjs";
import { decodeEucKr } from "./lib/csv.mjs";
import { buildAccountHistorySnapshots, parseAccountHistoryTotals } from "./lib/import-account-history.mjs";
import { validateSnapshots } from "./lib/validate.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = join(root, "data");
const args = process.argv.slice(2);
const replace = args.includes("--replace");
const paths = args.filter((arg) => !arg.startsWith("--"));
if (paths.length === 0) throw new Error("계좌수익률 CSV 경로가 필요합니다.");

const decodedTexts = paths.map((path) => decodeEucKr(readFileSync(path)));
const totals = parseAccountHistoryTotals(decodedTexts);

const fxHistory = JSON.parse(readFileSync(join(dataDir, "fx.json"), "utf8"));
const existingSnapshots = JSON.parse(readFileSync(join(dataDir, "snapshots.json"), "utf8"));
const existingCashflows = JSON.parse(readFileSync(join(dataDir, "cashflows.json"), "utf8"));
const snapshots = buildAccountHistorySnapshots(totals, { fxHistory, existingSnapshots, existingCashflows });

const validationErrors = validateSnapshots(snapshots);
if (validationErrors.length > 0) {
  console.error(`검증 실패${replace ? " — 반영을 중단합니다" : " (미리보기 파일은 그대로 씁니다)"}:`);
  for (const error of validationErrors) console.error(`  - ${error}`);
  if (replace) process.exit(1);
}

const target = join(dataDir, replace ? "snapshots.json" : "out-snapshots.json");
const write = () => writeJsonAtomic(target, `${JSON.stringify(snapshots, null, 2)}\n`);
if (replace) withDataLock(dataDir, write);
else write();
console.log(`${totals.size}일의 실제 계좌자산과 현금 입출금을 병합해 총 ${snapshots.length}개 스냅샷을 저장했습니다.`);
if (!replace) console.log("검토 후 --replace를 붙이면 실제 차트에 반영됩니다.");
