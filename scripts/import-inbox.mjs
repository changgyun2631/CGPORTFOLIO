/**
 * 받은 폴더(inbox)에 넣어둔 증권사 CSV를 알아서 가져온다.
 *
 * 증권사에서 내려받은 CSV를 `~/cgportfolio-inbox`에 넣어두기만 하면, 예약 실행이
 * 주기적으로 훑어서 종류를 판별하고 해당 가져오기를 돌린 뒤 파일을 치운다.
 * 웹 화면(`/accounts/import`)에서 매번 올리는 수고를 없애려는 것이다.
 *
 *   node scripts/import-inbox.mjs [--inbox=<경로>] [--dry-run]
 *
 * 설계상 지켜야 하는 것들:
 *
 * - **저장소 밖에 둔다.** inbox는 홈 폴더 아래다. 저장소 안에 두면 실제 계좌
 *   데이터가 든 CSV가 미추적 파일로 굴러다니게 되고, 저장소가 Public이라 위험하다.
 * - **파일 이름을 믿지 않는다.** 헤더를 읽어 종류를 정한다(`inbox-classify.mjs`).
 * - **판별 못 한 파일은 건드리지 않는다.** 실패 폴더로 옮기고 사유를 남긴다.
 *   엉뚱한 importer에 넘겨 데이터를 망가뜨리는 것보다 낫다.
 * - **적용 전에 백업한다.** 되돌릴 수 있어야 자동 적용을 신뢰할 수 있다.
 * - **처리한 파일은 옮긴다.** 그대로 두면 다음 주기에 같은 파일을 또 가져온다.
 * - 금액 같은 실제 값은 로그에 남기지 않는다. 파일명·종류·건수만 남긴다.
 */
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { backupData } from "./lib/backup.mjs";
import { decodeEucKr } from "./lib/csv.mjs";
import { classifyInboxCsv, INBOX_KIND_LABEL } from "./lib/inbox-classify.mjs";
import { trimLogFile } from "./lib/log-rotate.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = join(repoRoot, "data");
const backupRoot = join(homedir(), "cgportfolio-backups");
const logPath = join(homedir(), "cgportfolio-logs", "inbox-import.log");
const MAX_LOG_LINES = 500;

/** 보유종목 CSV를 넣을 계좌. 계좌가 하나뿐이라 고정해 둔다. */
const POSITION_BASIS_ACCOUNT_ID = "acc-us-main";

function parseArgs(argv) {
  const flags = {};
  for (const arg of argv) {
    if (!arg.startsWith("--")) continue;
    const [key, ...rest] = arg.slice(2).split("=");
    flags[key] = rest.length > 0 ? rest.join("=") : true;
  }
  return flags;
}

const flags = parseArgs(process.argv.slice(2));
const inboxDir = flags.inbox ?? join(homedir(), "cgportfolio-inbox");
const doneDir = join(inboxDir, "처리완료");
const failedDir = join(inboxDir, "실패");
const dryRun = flags["dry-run"] === true;

function log(line) {
  const stamped = `${new Date().toISOString()} ${line}`;
  process.stdout.write(`${stamped}\n`);
  try {
    mkdirSync(dirname(logPath), { recursive: true });
    appendFileSync(logPath, `${stamped}\n`, "utf8");
    trimLogFile(logPath, MAX_LOG_LINES);
  } catch {
    // 로그를 못 써도 가져오기 자체는 계속한다.
  }
}

/** 같은 이름이 이미 있으면 뒤에 번호를 붙여 덮어쓰지 않는다. */
function moveAside(filePath, targetDir, name) {
  mkdirSync(targetDir, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 10);
  const base = `${stamp}_${name}`;
  let target = join(targetDir, base);
  let n = 2;
  while (existsSync(target)) {
    target = join(targetDir, `${stamp}_${n}_${name}`);
    n += 1;
  }
  renameSync(filePath, target);
  return target;
}

/**
 * 아직 다 써지지 않은 파일을 건드리지 않는다. 다운로드 중인 파일을 읽으면
 * 잘린 CSV를 가져오게 된다 — 크기가 잠시 뒤에도 같을 때만 처리한다.
 */
function isSettled(filePath) {
  try {
    const first = statSync(filePath).size;
    if (first === 0) return false;
    // 동기 대기. 이 스크립트는 처음부터 끝까지 동기로 도는 편이 단순하다.
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1200);
    return statSync(filePath).size === first;
  } catch {
    return false;
  }
}

function runImporter(kind, filePath) {
  const script =
    kind === "account-history"
      ? join(repoRoot, "scripts", "import-account-history-csv.mjs")
      : join(repoRoot, "scripts", "import-position-basis-csv.mjs");

  const args = [script, filePath, "--replace"];
  if (kind === "position-basis") args.push(`--account-id=${POSITION_BASIS_ACCOUNT_ID}`);

  const result = spawnSync(process.execPath, args, { cwd: repoRoot, encoding: "utf8", timeout: 5 * 60 * 1000 });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim().split("\n").pop() ?? "";
  return { ok: result.status === 0, detail: output };
}

function main() {
  mkdirSync(inboxDir, { recursive: true });

  const entries = readdirSync(inboxDir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => [".csv", ".xlsx", ".xls"].includes(extname(name).toLowerCase()));

  if (entries.length === 0) return;

  log(`받은 폴더에 ${entries.length}개 발견 — ${inboxDir}`);
  let applied = 0;

  for (const name of entries) {
    const filePath = join(inboxDir, name);

    if (!isSettled(filePath)) {
      log(`  ${name}: 아직 쓰는 중으로 보여 이번엔 건너뜀`);
      continue;
    }

    // 엑셀 파일은 파서가 CSV만 다룬다. 조용히 실패시키지 않고 이유를 알려준다.
    if (extname(name).toLowerCase() !== ".csv") {
      log(`  ${name}: CSV가 아니라 처리 불가 — 증권사에서 CSV로 내보내 주세요`);
      moveAside(filePath, failedDir, name);
      continue;
    }

    let kind;
    try {
      kind = classifyInboxCsv(decodeEucKr(readFileSync(filePath)));
    } catch (error) {
      log(`  ${name}: 읽기 실패 — ${error.message}`);
      moveAside(filePath, failedDir, name);
      continue;
    }

    if (kind === "unknown") {
      log(`  ${name}: 어떤 가져오기인지 판별 못 함 — 건드리지 않고 실패 폴더로 옮김`);
      moveAside(filePath, failedDir, name);
      continue;
    }

    if (dryRun) {
      log(`  ${name}: [모의] ${INBOX_KIND_LABEL[kind]}(으)로 가져올 예정`);
      continue;
    }

    // 되돌릴 수 있게 적용 직전에 백업한다.
    try {
      backupData(dataDir, backupRoot);
    } catch (error) {
      log(`  ${name}: 백업 실패로 중단 — ${error.message}`);
      continue;
    }

    const { ok, detail } = runImporter(kind, filePath);
    if (ok) {
      applied += 1;
      moveAside(filePath, doneDir, name);
      log(`  ${name}: ${INBOX_KIND_LABEL[kind]} 반영 완료 — ${detail}`);
    } else {
      moveAside(filePath, failedDir, name);
      log(`  ${name}: ${INBOX_KIND_LABEL[kind]} 반영 실패 — ${detail}`);
    }
  }

  if (applied > 0) log(`${applied}건 반영됨. 화면은 새로고침하면 바로 보입니다.`);
}

try {
  main();
} catch (error) {
  log(`실패 — ${error.message}`);
  process.exitCode = 1;
}
