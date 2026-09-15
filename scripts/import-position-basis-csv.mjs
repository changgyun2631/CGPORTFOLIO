/**
 * 증권사 보유종목 CSV에서 현재 보유수량·매입원가·예상 매도수수료율을 가져온다.
 * 과거 거래원장은 거래 이력용이고, 현재 평가손익은 이 스냅샷을 우선 사용한다.
 *
 * node scripts/import-position-basis-csv.mjs <csv> --account-id=acc-main [--replace]
 */
import { readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { withDataLock, writeJsonAtomic } from "./lib/atomic-write.mjs";
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

function parseCsvLine(line) {
  const fields = [];
  let value = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (quoted && char === '"' && line[i + 1] === '"') {
      value += '"';
      i += 1;
    } else if (char === '"') quoted = !quoted;
    else if (char === "," && !quoted) {
      fields.push(value);
      value = "";
    } else value += char;
  }
  fields.push(value);
  return fields;
}

const number = (value) => Number(String(value ?? "0").replaceAll(",", "").replace("%", "").trim() || 0);
const { positional, flags } = parseArgs(process.argv.slice(2));
const csvPath = positional[0];
if (!csvPath) throw new Error("보유종목 CSV 경로가 필요합니다.");

const accountId = String(flags["account-id"] ?? "acc-main");
const decoded = new TextDecoder("euc-kr").decode(readFileSync(csvPath));
const rows = decoded.split(/\r?\n/).filter(Boolean).map(parseCsvLine);
const headerIndex = rows.findIndex((row) => row.includes("종목명") && row.includes("평가손익"));
if (headerIndex < 0) throw new Error("보유종목 CSV 헤더를 찾지 못했습니다.");

const headers = rows[headerIndex];
const at = String(flags["as-of"] ?? statSync(csvPath).mtime.toISOString());
const basis = rows.slice(headerIndex + 1)
  .map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ""])))
  .filter((row) => row["코드"])
  .map((row) => {
    const value = number(row["평가금액"]);
    const fee = number(row["수수료"]);
    return {
      at,
      accountId,
      symbolId: String(row["코드"]).replace(/^'/, ""),
      shares: number(row["보유량"]),
      averagePrice: number(row["매입가"]),
      costBasis: number(row["매입금액"]),
      estimatedExitFeeRate: value > 0 ? fee / value : 0,
    };
  })
  .filter((line) => line.shares > 0 && line.costBasis >= 0);

if (basis.length === 0) throw new Error("가져올 보유종목이 없습니다.");

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
