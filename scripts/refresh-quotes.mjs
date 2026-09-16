/**
 * `/api/cron/refresh`를 호출하고 결과를 로그로 남긴다.
 *
 * 화면은 저장된 시세만 읽고(`lib/data/store.ts`), 이 스크립트가 주기적으로
 * 불러서 갱신해 둬야 한다 — 원칙 2 참고. 호출 자체는 실제 시세 API를 부르는
 * `/api/cron/refresh` 라우트가 하고, 이 스크립트는 그 라우트가 항상 떠 있는
 * 서버에 대고 "지금 갱신해" 라고 요청만 한다. 서버가 안 떠 있으면(연결 실패)
 * 그것도 로그에 실패로 남는다.
 *
 *   node scripts/refresh-quotes.mjs [--url=http://localhost:3000/api/cron/refresh]
 *     [--secret=<CRON_SECRET>] [--log=<로그 경로>]
 *
 * 주기 실행: Windows 작업 스케줄러에 "몇 시간마다, 프로그램: node.exe, 인수:
 * scripts/refresh-quotes.mjs, 시작 위치: 이 저장소 경로"로 등록한다. 서버 자체가
 * 상시 구동 중이어야 하므로(예: 로그온 시 `npm start` 실행하는 별도 작업), 이
 * 스크립트 혼자서는 아무것도 못 채운다.
 *
 * 연결 실패 시 "CGPORTFOLIO 서버" 작업 스케줄러 상태를 확인해 "Running"이 아니면
 * 직접 기동을 시도한다(`tryRecoverServerTask`). Windows Update 자동 재부팅처럼
 * OS 전체가 내려가면 `start-server.cmd`의 재시작 루프까지 같이 죽어서 다음 날
 * 새벽 4시 DAILY 트리거까지 방치되는데, 이 스크립트가 6시간마다 도니 최악의 경우도
 * 6시간 안에는 복구된다 (WORK_ORDER.md B-0 참고).
 */
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { spawnSync } from "node:child_process";

import { trimLogFile } from "./lib/log-rotate.mjs";
import { classifyFetchError, describeRecoveryDecision } from "./lib/refresh-diagnostics.mjs";

const SERVER_TASK_NAME = "CGPORTFOLIO 서버";
const HEALTHCHECK_TIMEOUT_MS = 5_000;

/**
 * 서버 자체가 응답하는지 짧은 timeout으로 직접 확인한다. Task Scheduler의
 * `Running` 상태는 "작업이 시작됐다"만 알려줄 뿐 지금 실제로 요청에 응답하는지는
 * 보장하지 않는다 — 이 프로젝트에서 그 둘이 어긋나는 사례를 여러 번 겪었다
 * (WORK_ORDER B-0). `/api/cron/refresh`가 아니라 홈(`/`)을 치는 이유는 시세
 * API를 추가로 소비하지 않고 "서버 프로세스가 요청에 응답하는가"만 보려는
 * 것이다.
 */
async function checkServerHealth(origin) {
  try {
    const response = await fetch(origin, { signal: AbortSignal.timeout(HEALTHCHECK_TIMEOUT_MS) });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * 서버가 죽어 있으면(연결 실패) 재시작 루프(`start-server.cmd`)가 스스로 복구하는데,
 * Windows Update 자동 재부팅처럼 OS 전체가 내려가면 그 루프의 cmd.exe까지 같이
 * 죽어서 다음 DAILY(새벽 4시) 트리거까지 방치된다. 연결 실패 시 작업 스케줄러
 * 상태 + 실제 헬스체크를 같이 보고 "Running"이 아니면 직접 기동을 시도해 최대
 * 6시간(다음 갱신 주기) 안에는 복구되게 한다. "Running"인데 헬스체크가
 * 실패하면(스케줄러 상태와 실제 상태가 어긋난 경우) 정상으로 오판하지 않되,
 * 자동 종료·강제 재시작까지 범위를 넓히지는 않는다 — 정확한 진단·보고가
 * 이번 단계의 목표다(WORK_ORDER B-0A-1).
 */
async function tryRecoverServerTask(origin) {
  const state = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-Command", `(Get-ScheduledTask -TaskName '${SERVER_TASK_NAME}').State`],
    { encoding: "utf8" },
  );
  const taskState = state.stdout?.trim();

  if (state.status !== 0 || !taskState) {
    log(`서버 작업 상태 확인 실패: ${state.stderr?.trim() || state.error?.message || "알 수 없는 오류"}`);
    return;
  }

  const healthy = await checkServerHealth(origin);
  const decision = describeRecoveryDecision(taskState, healthy);
  log(decision.message);
  if (decision.action !== "start") return;

  const start = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-Command", `Start-ScheduledTask -TaskName '${SERVER_TASK_NAME}'`],
    { encoding: "utf8" },
  );
  if (start.status === 0) {
    log(`서버 작업 기동 요청 성공`);
  } else {
    log(`서버 작업 기동 요청 실패: ${start.stderr?.trim() || start.error?.message || "알 수 없는 오류"}`);
  }
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
const url = flags.url ?? "http://localhost:3000/api/cron/refresh";
const secret = flags.secret ?? process.env.CRON_SECRET;
const logDir = join(homedir(), "cgportfolio-logs");
const logPath = flags.log ?? join(logDir, "refresh.log");
const MAX_LOG_LINES = 500;

mkdirSync(dirname(logPath), { recursive: true });

function log(line) {
  const stamped = `${new Date().toISOString()} ${line}`;
  console.log(stamped);
  appendFileSync(logPath, `${stamped}\n`, "utf8");
}

/**
 * 로그 파일들이 무한정 커지지 않도록 최근 N줄만 남긴다. 이 스크립트의 로그뿐
 * 아니라 재시작 루프가 쓰는 `server.log`도 같이 정리한다 — `start-server.cmd`는
 * 배치 파일이라 자체 회전 로직을 넣기 까다롭고(한글 처리 문제로 이미 한 번
 * 죽은 전적이 있다, WORK_ORDER B-0), 이 스크립트가 6시간마다 안정적으로 도니
 * 별도 예약 작업 없이 청소 역할까지 겸한다.
 */
function trimLogs() {
  trimLogFile(logPath, MAX_LOG_LINES);
  trimLogFile(join(logDir, "server.log"), MAX_LOG_LINES);
}

// 정상 응답은 대개 3~4분(30종목 * 8개씩 분당 청크 + API 대기) 걸린다
// (WORK_ORDER 0-5절). 그보다 훨씬 넉넉한 여유를 둬서, 정상적인 대기를
// "죽었다"로 오판하지 않으면서도 진짜 매달림은 유한 시간 안에 실패로 끝낸다.
const REFRESH_TIMEOUT_MS = 10 * 60 * 1000;

async function main() {
  const headers = {};
  if (secret) headers.authorization = `Bearer ${secret}`;

  log(`갱신 요청 시작 → ${url}`);

  let response;
  try {
    response = await fetch(url, { headers, signal: AbortSignal.timeout(REFRESH_TIMEOUT_MS) });
  } catch (error) {
    const cause = classifyFetchError(error);
    const origin = new URL(url).origin;
    const healthy = await checkServerHealth(origin);
    if (healthy) {
      // 연결/요청은 실패했지만 서버(origin)는 실제로 응답한다 — "서버 사망"이
      // 아니라 /api/cron/refresh 처리 중 문제(느린 외부 API, 이 요청 자체의
      // timeout 등)로 좁혀서 보고한다. 살아있는 서버를 재시작 시도 대상으로
      // 삼지 않는다.
      log(`실패: 갱신 요청이 실패했지만(${cause}: ${error.message}) 서버(${origin})는 응답합니다 — /api/cron/refresh 처리 중 문제로 보입니다.`);
    } else {
      log(`실패: 서버에 연결하지 못했습니다 (${cause}: ${error.message}). 서버(${origin}) 헬스체크도 실패했습니다.`);
      await tryRecoverServerTask(origin);
    }
    trimLogs();
    process.exitCode = 1;
    return;
  }

  const body = await response.json().catch(() => null);

  if (!response.ok || !body?.ok) {
    log(`실패: HTTP ${response.status} ${JSON.stringify(body)}`);
    trimLogs();
    process.exitCode = 1;
    return;
  }

  // 총액(개인 금융 데이터)은 로그에 남기지 않는다 — 건수·소요시간만 남긴다.
  log(
    `성공: 갱신 ${body.updated}건, 누락 ${body.missing.length}건${body.missing.length ? ` (${body.missing.join(",")})` : ""}, ` +
      `오류 ${body.errors.length}건, ${body.elapsedMs}ms`,
  );
  trimLogs();
}

main();
