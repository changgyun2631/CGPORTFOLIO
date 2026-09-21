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
import { basename, dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { backupData } from "./lib/backup.mjs";
import { decodeBrokerCsv } from "./lib/csv.mjs";
import { classifyInboxCsv, INBOX_KIND_LABEL } from "./lib/inbox-classify.mjs";
import { trimLogFile } from "./lib/log-rotate.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = join(repoRoot, "data");
const backupRoot = join(homedir(), "cgportfolio-backups");
const logPath = join(homedir(), "cgportfolio-logs", "inbox-import.log");
const MAX_LOG_LINES = 500;

/**
 * 보유종목(잔고) CSV가 어느 계좌 것인지는 **파일이 놓인 하위 폴더 이름**으로 정한다.
 * `~/cgportfolio-inbox/<계좌ID 또는 계좌이름>/잔고.csv` 처럼 넣으면 된다.
 *
 * 예전에는 계좌가 하나뿐이라 계좌를 코드에 고정해 뒀는데, 계좌가 늘어난 뒤로는
 * 그게 위험하다 — 잔고 가져오기는 **대상 계좌의 기준값을 통째로 교체**하므로,
 * 다른 계좌 CSV를 넣으면 엉뚱한 계좌 잔고를 덮어쓴다. 그래서 폴더로 계좌를
 * 밝히지 않은 잔고 CSV는 아예 반영하지 않고 실패로 뺀다(짐작하지 않는다).
 *
 * 계좌수익률 CSV는 여러 계좌를 날짜별로 합산해 총 평가금액 차트를 만드는 것이라
 * 계좌 구분이 필요 없다 — inbox 루트에 그냥 둬도 된다.
 */
function loadAccounts() {
  try {
    return JSON.parse(readFileSync(join(dataDir, "accounts.json"), "utf8"));
  } catch {
    return [];
  }
}

/** 폴더 이름을 계좌 ID로 바꾼다. 계좌 ID와 계좌 이름 둘 다 받아준다. */
function resolveAccountId(folderName, accounts) {
  if (!folderName) return null;
  const match = accounts.find((account) => account.id === folderName || account.name === folderName);
  return match?.id ?? null;
}

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

function runImporter(kind, filePath, accountId) {
  const script =
    kind === "account-history"
      ? join(repoRoot, "scripts", "import-account-history-csv.mjs")
      : join(repoRoot, "scripts", "import-position-basis-csv.mjs");

  const args = [script, filePath, "--replace"];
  if (kind === "position-basis") args.push(`--account-id=${accountId}`);

  const result = spawnSync(process.execPath, args, { cwd: repoRoot, encoding: "utf8", timeout: 5 * 60 * 1000 });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim().split("\n").pop() ?? "";
  return { ok: result.status === 0, detail: output };
}

/**
 * inbox 루트와 계좌별 하위 폴더를 한 단계까지 훑는다. 처리완료·실패 폴더는
 * 이미 처리한 파일을 모아 둔 곳이라 다시 읽지 않는다.
 */
function collectEntries() {
  const RESERVED = new Set(["처리완료", "실패"]);
  const isTarget = (name) => [".csv", ".xlsx", ".xls"].includes(extname(name).toLowerCase());
  const found = [];

  for (const entry of readdirSync(inboxDir, { withFileTypes: true })) {
    if (entry.isFile() && isTarget(entry.name)) {
      found.push({ name: entry.name, filePath: join(inboxDir, entry.name), folder: null });
      continue;
    }
    if (!entry.isDirectory() || RESERVED.has(entry.name)) continue;

    const subDir = join(inboxDir, entry.name);
    for (const child of readdirSync(subDir, { withFileTypes: true })) {
      if (!child.isFile() || !isTarget(child.name)) continue;
      found.push({ name: `${entry.name}/${child.name}`, filePath: join(subDir, child.name), folder: entry.name });
    }
  }

  return found;
}

function main() {
  mkdirSync(inboxDir, { recursive: true });

  const entries = collectEntries();
  if (entries.length === 0) return;

  const accounts = loadAccounts();
  log(`받은 폴더에 ${entries.length}개 발견 — ${inboxDir}`);
  let applied = 0;

  for (const { name, filePath, folder } of entries) {

    if (!isSettled(filePath)) {
      log(`  ${name}: 아직 쓰는 중으로 보여 이번엔 건너뜀`);
      continue;
    }

    // 엑셀 파일은 파서가 CSV만 다룬다. 조용히 실패시키지 않고 이유를 알려준다.
    if (extname(name).toLowerCase() !== ".csv") {
      log(`  ${name}: CSV가 아니라 처리 불가 — 증권사에서 CSV로 내보내 주세요`);
      moveAside(filePath, failedDir, basename(name));
      continue;
    }

    let kind;
    try {
      kind = classifyInboxCsv(decodeBrokerCsv(readFileSync(filePath)));
    } catch (error) {
      log(`  ${name}: 읽기 실패 — ${error.message}`);
      moveAside(filePath, failedDir, basename(name));
      continue;
    }

    if (kind === "unknown") {
      log(`  ${name}: 어떤 가져오기인지 판별 못 함 — 건드리지 않고 실패 폴더로 옮김`);
      moveAside(filePath, failedDir, basename(name));
      continue;
    }

    // 잔고는 대상 계좌를 통째로 교체하므로, 어느 계좌인지 확실할 때만 반영한다.
    let accountId = null;
    if (kind === "position-basis") {
      accountId = resolveAccountId(folder, accounts);
      if (!accountId) {
        const reason = folder
          ? `"${folder}"에 해당하는 계좌가 없음`
          : "계좌를 알 수 없음(계좌 폴더에 넣어야 합니다)";
        log(`  ${name}: 보유종목(잔고) ${reason} — 반영하지 않고 실패 폴더로 옮김`);
        moveAside(filePath, failedDir, basename(name));
        continue;
      }
    }

    if (dryRun) {
      const target = accountId ? ` → ${accountId}` : "";
      log(`  ${name}: [모의] ${INBOX_KIND_LABEL[kind]}(으)로 가져올 예정${target}`);
      continue;
    }

    // 되돌릴 수 있게 적용 직전에 백업한다.
    try {
      backupData(dataDir, backupRoot);
    } catch (error) {
      log(`  ${name}: 백업 실패로 중단 — ${error.message}`);
      continue;
    }

    const { ok, detail } = runImporter(kind, filePath, accountId);
    if (ok) {
      applied += 1;
      moveAside(filePath, doneDir, basename(name));
      log(`  ${name}: ${INBOX_KIND_LABEL[kind]} 반영 완료 — ${detail}`);
    } else {
      moveAside(filePath, failedDir, basename(name));
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
