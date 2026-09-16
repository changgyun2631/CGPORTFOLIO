/**
 * 백업이 실제로 복원 가능한지 검사한다. 만들기만 하고 한 번도 열어보지 않은
 * 백업은 백업이 아니다 — 지정한 백업(기본: 최신)을 임시 폴더에 복사해 JSON
 * 파싱·필수 파일 존재·참조 무결성을 검사한다. 운영 `data/`는 전혀 건드리지
 * 않는다: 읽기만 하고, 복사본은 임시 폴더에서만 만든다.
 *
 *   node scripts/verify-backup.mjs [<백업 폴더>] [--keep-temp]
 *
 * 인자를 생략하면 `~/cgportfolio-backups/` 아래 가장 최신 타임스탬프 폴더를 쓴다.
 * `--keep-temp`를 주면 검사 후에도 임시 복원 폴더를 지우지 않는다(직접 열어보고
 * 싶을 때).
 *
 * 이 스크립트는 "리허설"만 한다 — 운영 data/에 실제로 되돌려 쓰는 자동 복원은
 * 일부러 만들지 않았다. 실제 복원 절차는 HANDOFF.md의 수동 명령을 따를 것.
 */
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";

import { validateAll } from "./lib/validate.mjs";

const positional = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
const keepTemp = process.argv.includes("--keep-temp");
const backupRoot = join(homedir(), "cgportfolio-backups");

function latestBackup() {
  if (!existsSync(backupRoot)) throw new Error(`백업 폴더가 없습니다: ${backupRoot}`);
  const entries = readdirSync(backupRoot)
    .filter((name) => /^\d{4}-\d{2}-\d{2}T/.test(name))
    .map((name) => join(backupRoot, name))
    .filter((path) => statSync(path).isDirectory())
    .sort()
    .reverse();
  if (entries.length === 0) throw new Error(`${backupRoot} 에 백업이 없습니다.`);
  return entries[0];
}

const source = positional[0] ?? latestBackup();
if (!existsSync(source)) throw new Error(`백업 경로가 없습니다: ${source}`);

const rehearsalDir = mkdtempSync(join(tmpdir(), "cgportfolio-restore-check-"));
console.log(`검사 대상: ${source}`);
console.log(`임시 복원 위치: ${rehearsalDir} (운영 data/ 는 건드리지 않습니다)`);
cpSync(source, rehearsalDir, { recursive: true });

const REQUIRED_FILES = [
  "accounts.json",
  "symbols.json",
  "transactions.json",
  "cashflows.json",
  "dividends.json",
  "snapshots.json",
  "quotes.json",
  "fx-quote.json",
];
const OPTIONAL_FILES = ["position-basis.json"];

function readJsonOrFail(name, errors) {
  const path = join(rehearsalDir, name);
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    errors.push(`${name}: JSON 파싱 실패 (${error.message})`);
    return undefined;
  }
}

const errors = [];
for (const name of REQUIRED_FILES) {
  if (!existsSync(join(rehearsalDir, name))) errors.push(`${name}: 백업에 없음 (필수 파일)`);
}

const parsed = {};
for (const name of [...REQUIRED_FILES, ...OPTIONAL_FILES]) {
  parsed[name] = readJsonOrFail(name, errors);
}

// 필수 파일이 하나라도 없거나 파싱이 안 되면 참조 무결성 검사는 의미가 없다.
if (errors.length === 0) {
  errors.push(
    ...validateAll({
      accounts: parsed["accounts.json"],
      symbols: parsed["symbols.json"],
      transactions: parsed["transactions.json"],
      cashflows: parsed["cashflows.json"],
      dividends: parsed["dividends.json"],
      positionBasis: parsed["position-basis.json"] ?? [],
      snapshots: parsed["snapshots.json"],
    }),
  );
}

if (!keepTemp) rmSync(rehearsalDir, { recursive: true, force: true });

if (errors.length > 0) {
  console.error(`복원 리허설 실패: ${errors.length}건`);
  for (const error of errors) console.error(`  - ${error}`);
  process.exitCode = 1;
} else {
  console.log("복원 리허설 통과: 필수 파일 존재·JSON 파싱·참조 무결성 이상 없음.");
  console.log("실제로 복원하려면 HANDOFF.md의 수동 복원 절차를 따르세요.");
}
