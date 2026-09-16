/**
 * 거래원장의 주식 이체·액면분할과 현금흐름 성격을 명시한다.
 *
 * 실제 정규화 로직은 `scripts/lib/ledger-normalize.mjs`(순수 함수)에 있다 —
 * 웹 가져오기 화면(`lib/import/`)도 같은 함수를 쓴다. 이 파일은 CLI 인자
 * 처리와 파일 IO만 담당하는 얇은 wrapper다.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { withDataLock, writeJsonAtomic } from "./lib/atomic-write.mjs";
import { normalizeLedger } from "./lib/ledger-normalize.mjs";
import { validateCashFlows, validateTransactions } from "./lib/validate.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = join(root, "data");
const replace = process.argv.includes("--replace");

const transactions = JSON.parse(readFileSync(join(dataDir, "transactions.json"), "utf8"));
const cashflows = JSON.parse(readFileSync(join(dataDir, "cashflows.json"), "utf8"));
const symbols = JSON.parse(readFileSync(join(dataDir, "symbols.json"), "utf8"));

const { transactions: normalizedTransactions, cashflows: normalizedCashflows } = normalizeLedger({
  transactions,
  cashflows,
  symbols,
});

const accounts = JSON.parse(readFileSync(join(dataDir, "accounts.json"), "utf8"));
const accountIds = new Set(accounts.map((account) => account.id));
const symbolIds = new Set(symbols.map((symbol) => symbol.id));
const validationErrors = [
  ...validateTransactions(normalizedTransactions, { accountIds, symbolIds }),
  ...validateCashFlows(normalizedCashflows, { accountIds }),
];
if (validationErrors.length > 0) {
  console.error(`검증 실패${replace ? " — 반영을 중단합니다" : " (미리보기 파일은 그대로 씁니다)"}:`);
  for (const error of validationErrors) console.error(`  - ${error}`);
  if (replace) process.exit(1);
}

const prefix = replace ? "" : "out-";
const write = () => {
  writeJsonAtomic(join(dataDir, `${prefix}transactions.json`), `${JSON.stringify(normalizedTransactions, null, 2)}\n`);
  writeJsonAtomic(join(dataDir, `${prefix}cashflows.json`), `${JSON.stringify(normalizedCashflows, null, 2)}\n`);
};
if (replace) withDataLock(dataDir, write);
else write();
console.log(`거래 ${normalizedTransactions.length}건과 현금흐름 ${normalizedCashflows.length}건을 정규화했습니다.`);
if (!replace) console.log("검토 후 --replace를 붙이면 실제 원장에 반영됩니다.");
