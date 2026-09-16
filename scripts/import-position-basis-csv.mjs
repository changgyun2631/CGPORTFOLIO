/**
 * 증권사 보유종목 CSV에서 현재 보유수량·매입원가·예상 매도수수료율을 가져온다.
 * 과거 거래원장은 거래 이력용이고, 현재 평가손익은 이 스냅샷을 우선 사용한다.
 *
 * 실제 파싱·검증 로직은 `scripts/lib/import-position-basis.mjs`(순수 함수)에
 * 있다 — 웹 가져오기 화면(`lib/import/`)도 같은 함수를 쓴다. 이 파일은 CLI
 * 인자 처리와 파일 IO만 담당하는 얇은 wrapper다.
 *
 * node scripts/import-position-basis-csv.mjs <csv> --account-id=acc-main [--replace]
 */
import { readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { withDataLock, writeJsonAtomic } from "./lib/atomic-write.mjs";
import { decodeEucKr } from "./lib/csv.mjs";
import { crossCheckPositionBasis } from "./lib/cross-check.mjs";
import { parsePositionBasisCsv } from "./lib/import-position-basis.mjs";
import { validateBasisNotRegressing, validatePositionBasis } from "./lib/validate.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = join(root, "data");

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (const arg of argv) {
    if (!arg.startsWith("--")) positional.push(arg);
    else {
      const [key, ...rest] = arg.slice(2).split("=");
      flags[key] = rest.length ? rest.join("=") : true;
    }
  }
  return { positional, flags };
}

const { positional, flags } = parseArgs(process.argv.slice(2));
const csvPath = positional[0];
if (!csvPath) throw new Error("보유종목 CSV 경로가 필요합니다.");

const accountId = String(flags["account-id"] ?? "acc-main");
const decoded = decodeEucKr(readFileSync(csvPath));
const at = String(flags["as-of"] ?? statSync(csvPath).mtime.toISOString());
const { basis, crossCheckInput } = parsePositionBasisCsv(decoded, { accountId, at });

// CSV 자체의 "평가손익" 열과, 우리가 평가금액-매입금액-수수료로 재계산한 값을
// 맞춰본다. 시세 API가 아니라 CSV 내부 일관성만 보므로 파싱이 잘못됐을 때(열이
// 밀렸거나 인코딩이 깨졌거나)를 화면에서 숫자가 이상하다고 느끼기 전에 잡아낸다.
// 실제 금액이 들어간 상세 리포트는 gitignored 출력 파일에만 남기고, 터미널에는
// 종목명과 개수만 보여준다.
const crossCheck = crossCheckPositionBasis(crossCheckInput);
const crossCheckReportPath = join(dataDir, "out-position-basis-crosscheck.json");
writeJsonAtomic(crossCheckReportPath, `${JSON.stringify(crossCheck, null, 2)}\n`);
if (!crossCheck.ok) {
  console.error(
    `교차검증: ${crossCheck.exceeded.length}개 종목이 허용 오차(±${crossCheck.toleranceKrw}원)를 초과했습니다 ` +
      `(${crossCheck.exceeded.join(", ")}). 상세 금액은 ${crossCheckReportPath} 참고.`,
  );
  if (flags.replace) {
    console.error("교차검증 실패 — 반영을 중단합니다.");
    process.exit(1);
  }
}

const accounts = JSON.parse(readFileSync(join(dataDir, "accounts.json"), "utf8"));
const symbols = JSON.parse(readFileSync(join(dataDir, "symbols.json"), "utf8"));
const accountIds = new Set(accounts.map((account) => account.id));
const symbolIds = new Set(symbols.map((symbol) => symbol.id));
const validationErrors = [...validatePositionBasis(basis, { accountIds, symbolIds })];
if (flags.replace) {
  const transactions = JSON.parse(readFileSync(join(dataDir, "transactions.json"), "utf8"));
  const cashflows = JSON.parse(readFileSync(join(dataDir, "cashflows.json"), "utf8"));
  validationErrors.push(...validateBasisNotRegressing(basis, { transactions, cashflows }));
}
if (validationErrors.length > 0) {
  console.error(`검증 실패${flags.replace ? " — 반영을 중단합니다" : " (미리보기 파일은 그대로 씁니다)"}:`);
  for (const error of validationErrors) console.error(`  - ${error}`);
  if (flags.replace) process.exit(1);
}

const target = join(dataDir, flags.replace ? "position-basis.json" : "out-position-basis.json");
const write = () => writeJsonAtomic(target, `${JSON.stringify(basis, null, 2)}\n`);
if (flags.replace) withDataLock(dataDir, write);
else write();
console.log(`현재 잔고 기준 ${basis.length}종목을 ${target}에 저장했습니다.`);
if (!flags.replace) console.log("검토 후 --replace를 붙이면 실제 화면 기준값으로 반영됩니다.");
