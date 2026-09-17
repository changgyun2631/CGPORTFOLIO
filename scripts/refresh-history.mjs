/**
 * 일별 가격·환율 이력을 하루치씩 이어붙인다.
 *
 *   node scripts/refresh-history.mjs [--dry-run]
 *
 * 시세 갱신(`refresh-quotes.mjs`)과 역할이 다르다. 그쪽은 "지금 값"인
 * `quotes.json`·`fx-quote.json`을 채워서 대시보드 숫자를 맞추고, 이쪽은
 * "지나간 날들"인 `prices.json`·`fx.json`을 늘린다. 백테스트와 종목 상세
 * 차트는 후자만 읽기 때문에, 이 작업이 안 돌면 대시보드는 멀쩡한데 백테스트
 * 종료일만 과거에 멈춰 있게 된다 — 화면상 아무 표시가 없어서 알아채기 어렵다.
 *
 * 미국장 종가가 확정된 뒤에 도는 것을 전제로 한다(한국시간 이른 아침).
 * 장중에 돌리면 그날 값이 종가가 아닌 중간값으로 들어가고, 다음 날 같은
 * 날짜를 다시 받아 덮어쓴다(`mergePriceHistory`가 날짜 기준으로 합친다).
 *
 * 두 단계는 서로 독립이다 — 가격이 실패해도 환율은 시도한다. 하나라도
 * 실패하면 0이 아닌 코드로 끝내서 작업 스케줄러 기록에 남게 한다.
 */
import { spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { trimLogFile } from "./lib/log-rotate.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const logPath = join(homedir(), "cgportfolio-logs", "history-refresh.log");
const MAX_LOG_LINES = 500;

const dryRun = process.argv.slice(2).includes("--dry-run");

function log(line) {
  const stamped = `${new Date().toISOString()} ${line}`;
  process.stdout.write(`${stamped}\n`);
  try {
    mkdirSync(dirname(logPath), { recursive: true });
    appendFileSync(logPath, `${stamped}\n`, "utf8");
    trimLogFile(logPath, MAX_LOG_LINES);
  } catch {
    // 로그를 못 써도 갱신 자체는 계속한다.
  }
}

/** 시세 공급자의 분당 제한 때문에 종목 수에 비례해 오래 걸린다. 넉넉히 준다. */
const STEP_TIMEOUT_MS = 20 * 60 * 1000;

function runStep(label, script, extra = []) {
  const args = [join(repoRoot, "scripts", script), "--replace", ...extra];
  if (dryRun) {
    log(`  ${label}: [모의] ${script} ${["--replace", ...extra].join(" ")} 실행 예정`);
    return true;
  }

  const startedAt = Date.now();
  const result = spawnSync(process.execPath, args, { cwd: repoRoot, encoding: "utf8", timeout: STEP_TIMEOUT_MS });
  const seconds = Math.round((Date.now() - startedAt) / 1000);
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim().split("\n").pop() ?? "";

  if (result.status === 0) {
    log(`  ${label}: 완료 (${seconds}초) — ${output}`);
    return true;
  }
  log(`  ${label}: 실패 (${seconds}초, 코드 ${result.status ?? "timeout"}) — ${output}`);
  return false;
}

log("일별 이력 갱신 시작");
// 한 종목이 분당 한도에 걸렸다고 나머지 종목의 하루를 통째로 버리지 않는다.
const priceOk = runStep("가격 이력", "fetch-price-history.mjs", ["--allow-partial"]);
const fxOk = runStep("환율 이력", "fetch-fx-history.mjs");

if (priceOk && fxOk) {
  log("일별 이력 갱신 완료");
} else {
  log(`일별 이력 갱신 일부 실패 — 가격:${priceOk ? "성공" : "실패"} 환율:${fxOk ? "성공" : "실패"}`);
  process.exitCode = 1;
}
