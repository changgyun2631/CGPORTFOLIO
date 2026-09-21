/**
 * 증권사 거래내역 CSV(키움 2110 화면)를 거래원장·현금흐름·배당으로 가져온다.
 *
 * 실제 파싱·검산 로직은 `scripts/lib/import-transactions.mjs`(순수 함수)에 있다.
 * 이 파일은 CLI 인자 처리와 파일 IO만 담당하는 얇은 wrapper다.
 *
 *   node scripts/import-transactions-csv.mjs <csv> --account-id=kiwoom-2 [--replace]
 *
 * 붙이지 않으면 `data/out-*.json`에 미리보기만 쓴다. `--replace`를 붙여야 실제
 * 원장을 바꾼다. 출력 파일도 개인 금융 데이터라 `.gitignore` 대상이다.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { withDataLock, writeJsonAtomic } from "./lib/atomic-write.mjs";
import { decodeBrokerCsv } from "./lib/csv.mjs";
import { parseTransactionsCsv } from "./lib/import-transactions.mjs";
import { validateCashFlows, validateDividends, validateTransactions } from "./lib/validate.mjs";

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

function readJson(name) {
  return JSON.parse(readFileSync(join(dataDir, name), "utf8"));
}

const { positional, flags } = parseArgs(process.argv.slice(2));
const csvPath = positional[0];
if (!csvPath) throw new Error("거래내역 CSV 경로가 필요합니다.");

const accountId = String(flags["account-id"] ?? "");
if (!accountId) throw new Error("--account-id=<계좌ID>가 필요합니다. 계좌를 짐작하지 않습니다.");

const parsed = parseTransactionsCsv(decodeBrokerCsv(readFileSync(csvPath)), { accountId });
const { transactions, cashflows, dividends, coverage, crossCheck, warnings } = parsed;

for (const warning of warnings) console.warn(`경고: ${warning}`);

if (!crossCheck.ok) {
  // 열이 밀렸거나 "한 거래 세 줄"이 어긋나면 여기서 걸린다. 실제 금액은 찍지 않는다.
  console.error(`검산 실패: ${crossCheck.checked}건 중 ${crossCheck.mismatches.length}건이 CSV 자체 계산과 맞지 않습니다.`);
  for (const mismatch of crossCheck.mismatches.slice(0, 5)) {
    console.error(`  - ${mismatch.at.slice(0, 10)} ${mismatch.note}: ${mismatch.reason}`);
  }
  if (flags.replace) {
    console.error("반영을 중단합니다.");
    process.exit(1);
  }
}

const accounts = readJson("accounts.json");
const symbols = readJson("symbols.json");
const accountIds = new Set(accounts.map((account) => account.id));
const symbolIds = new Set(symbols.map((symbol) => symbol.id));

// 없는 계좌면 모든 줄이 같은 이유로 실패한다. 2천 줄을 쏟아내는 대신 한 줄로 끝낸다.
if (!accountIds.has(accountId)) {
  console.error(`accounts.json에 "${accountId}" 계좌가 없습니다. 계좌를 먼저 등록하거나 --account-id를 확인해 주세요.`);
  process.exit(1);
}

// 원장에 없는 종목은 먼저 symbols.json에 등록해야 한다. 검증 오류 수십 줄로
// 흩어지기 전에 한 줄로 모아 보여준다 — 사람이 해야 할 일이 그것뿐이기 때문이다.
const unknownSymbols = [...new Set([...transactions, ...dividends].map((row) => row.symbolId))]
  .filter((symbolId) => !symbolIds.has(symbolId))
  .sort();
if (unknownSymbols.length > 0) {
  console.error(`symbols.json에 없는 종목 ${unknownSymbols.length}개: ${unknownSymbols.join(", ")} — 먼저 등록해 주세요.`);
}

const validationErrors = [
  ...validateTransactions(transactions, { accountIds, symbolIds }),
  ...validateCashFlows(cashflows, { accountIds }),
  ...validateDividends(dividends, { accountIds, symbolIds }),
];
if (validationErrors.length > 0) {
  console.error(`검증 실패${flags.replace ? " — 반영을 중단합니다" : " (미리보기 파일은 그대로 씁니다)"}:`);
  for (const error of validationErrors.slice(0, 20)) console.error(`  - ${error}`);
  if (validationErrors.length > 20) console.error(`  … 외 ${validationErrors.length - 20}건`);
  if (flags.replace) process.exit(1);
}

/**
 * 이 CSV는 **한 계좌의, 조회 기간만큼의** 거래다. 파일 전체를 이걸로 덮어쓰면
 * 다른 계좌 원장이 통째로 사라지고(2026-09-21 잔고 가져오기에서 실제로 겪은 사고다),
 * 같은 계좌라도 조회 기간 밖의 옛 거래까지 지워진다. 그래서 **대상 계좌의,
 * 조회 기간 안에 있는 줄만** 갈아끼운다.
 */
function mergeIntoExisting(existing, incoming) {
  const kept = existing.filter((row) => {
    if (row.accountId !== accountId) return true;
    return row.at < coverage.from || row.at > coverage.to;
  });
  return [...kept, ...incoming].sort((a, b) => String(a.at).localeCompare(String(b.at)));
}

const targets = [
  { name: "transactions", rows: transactions },
  { name: "cashflows", rows: cashflows },
  { name: "dividends", rows: dividends },
];

const write = () => {
  for (const { name, rows } of targets) {
    if (flags.replace) {
      const merged = mergeIntoExisting(readJson(`${name}.json`), rows);
      writeJsonAtomic(join(dataDir, `${name}.json`), `${JSON.stringify(merged, null, 2)}\n`);
    } else {
      writeJsonAtomic(join(dataDir, `out-${name}.json`), `${JSON.stringify(rows, null, 2)}\n`);
    }
  }
};

if (flags.replace) withDataLock(dataDir, write);
else write();

console.log(
  `계좌 ${accountId}: 거래 ${transactions.length}건, 현금흐름 ${cashflows.length}건, 배당 ${dividends.length}건을 ` +
    `${coverage.from.slice(0, 10)}~${coverage.to.slice(0, 10)} 기간으로 ${flags.replace ? "반영했습니다" : "미리보기에 저장했습니다"}.`,
);
if (!flags.replace) console.log("검토 후 --replace를 붙이면 실제 원장에 반영됩니다.");
