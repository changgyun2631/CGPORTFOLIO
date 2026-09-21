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
import { appendFileSync, mkdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { spawnSync } from "node:child_process";

import { trimLogFile } from "./lib/log-rotate.mjs";
import { loadLocalEnv } from "./lib/load-local-env.mjs";
import { refreshCalendar } from "./lib/calendar-refresh.mjs";
import { REFRESH_EXIT, classifyFetchError, classifyJobOutcome, describeRecoveryDecision } from "./lib/refresh-diagnostics.mjs";

loadLocalEnv();

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

/**
 * 접수 요청과 상태 조회는 둘 다 즉시 끝나야 정상이다. 예전처럼 갱신이 끝날 때까지
 * 응답 하나를 붙잡고 기다리지 않으므로, Undici `headersTimeout`(5분, 옵션으로 못
 * 늘린다)에 걸려 성공을 실패로 보고하던 문제가 구조적으로 사라진다.
 */
const REQUEST_TIMEOUT_MS = 30_000;
/** 상태를 물어보는 간격. 갱신은 보통 7분쯤 걸린다. */
const POLL_INTERVAL_MS = 15_000;
/** 여기를 넘기면 매달린 것으로 보고 실패로 끝낸다. */
const JOB_TIMEOUT_MS = 20 * 60 * 1000;

const statusUrl = new URL(url);
statusUrl.pathname = `${statusUrl.pathname.replace(/\/$/, "")}/status`;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 세 파일이 작업 시작 이후에 실제로 갱신됐는지 본다. 작업이 `done`이라고 해도
 * 데이터가 안 바뀌었으면 성공으로 치지 않는다.
 */
function dataFilesTouchedSince(startedAtMs) {
  const dataDir = join(process.cwd(), "data");
  const files = ["quotes.json", "fx-quote.json", "snapshots.json"];
  const stale = [];
  for (const name of files) {
    try {
      if (statSync(join(dataDir, name)).mtimeMs + 1000 < startedAtMs) stale.push(name);
    } catch {
      stale.push(name);
    }
  }
  return stale;
}

async function main() {
  // 기존 6시간 예약 작업에 무료 캘린더도 연결한다. 실패해도 시세 갱신은 계속한다.
  try {
    const calendar = await refreshCalendar();
    log(`캘린더: 확인 ${calendar.updated}건, 실패 ${calendar.errors}건`);
  } catch (error) {
    log(`캘린더 수집 실패(시세 갱신 계속): ${error.message}`);
  }
  const headers = {};
  if (secret) headers.authorization = `Bearer ${secret}`;

  log(`갱신 요청 시작 → ${url}`);

  let response;
  try {
    response = await fetch(url, { headers, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  } catch (error) {
    const cause = classifyFetchError(error);
    const origin = new URL(url).origin;
    const healthy = await checkServerHealth(origin);
    if (healthy) {
      log(`실패: 접수 요청이 실패했지만(${cause}: ${error.message}) 서버(${origin})는 응답합니다.`);
    } else {
      log(`실패: 서버에 연결하지 못했습니다 (${cause}: ${error.message}). 서버(${origin}) 헬스체크도 실패했습니다.`);
      await tryRecoverServerTask(origin);
    }
    trimLogs();
    process.exitCode = REFRESH_EXIT.server;
    return;
  }

  const accepted = await response.json().catch(() => null);

  if (response.status === 409) {
    log(`건너뜀: 이미 갱신이 진행 중입니다 (job ${accepted?.jobId ?? "?"}). 중복 실행하지 않습니다.`);
    trimLogs();
    process.exitCode = REFRESH_EXIT.duplicate;
    return;
  }
  if (!response.ok || !accepted?.jobId) {
    log(`실패: 접수 거부 HTTP ${response.status} ${JSON.stringify(accepted)}`);
    trimLogs();
    process.exitCode = REFRESH_EXIT.server;
    return;
  }

  const jobId = accepted.jobId;
  const startedAtMs = Date.now();
  log(`접수됨: job ${jobId} — 상태를 ${POLL_INTERVAL_MS / 1000}초마다 확인합니다`);

  const pollUrl = new URL(statusUrl);
  pollUrl.searchParams.set("jobId", jobId);

  while (Date.now() - startedAtMs < JOB_TIMEOUT_MS) {
    await sleep(POLL_INTERVAL_MS);

    let job = null;
    try {
      const poll = await fetch(pollUrl, { headers, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
      job = (await poll.json().catch(() => null))?.job ?? null;
    } catch (error) {
      // 조회 한 번 실패는 치명적이지 않다 — 다음 주기에 다시 묻는다.
      log(`상태 조회 실패(계속 대기) — ${classifyFetchError(error)}: ${error.message}`);
      continue;
    }

    if (!job) {
      log(`실패: job ${jobId} 상태를 알 수 없습니다 — 서버가 재시작됐을 수 있습니다.`);
      trimLogs();
      process.exitCode = REFRESH_EXIT.server;
      return;
    }
    if (job.status === "running") continue;

    // "완료 보고"만으로 성공 처리하지 않는다 — 세 파일이 실제로 갱신됐는지까지 본다.
    const staleFiles = job.status === "done" ? dataFilesTouchedSince(startedAtMs) : [];
    const outcome = classifyJobOutcome({ job, staleFiles });
    const failure = job.failure ?? {};

    // 총액(개인 금융 데이터)은 로그에 남기지 않는다 — 건수·소요시간·원인만 남긴다.
    if (outcome.code === REFRESH_EXIT.ok) {
      log(
        `성공: job ${jobId} — 갱신 ${job.updated}건, 누락 ${job.missingCount}건, 오류 ${job.errorCount}건, ${job.elapsedMs}ms`,
      );
    } else if (outcome.reason === "stale-data") {
      log(`실패(${outcome.reason}): job ${jobId}는 완료로 보고됐지만 갱신되지 않은 파일이 있습니다 — ${staleFiles.join(", ")}`);
    } else {
      log(
        `실패(${outcome.reason}): job ${jobId} 단계 ${job.stage}` +
          `${failure.provider ? ` · provider ${failure.provider}` : ""}: ${failure.message ?? ""} · ${job.elapsedMs ?? "?"}ms`,
      );
    }

    trimLogs();
    process.exitCode = outcome.code;
    return;
  }

  log(`실패: job ${jobId}가 ${JOB_TIMEOUT_MS / 60000}분 안에 끝나지 않았습니다 — 매달린 것으로 봅니다.`);
  trimLogs();
  process.exitCode = REFRESH_EXIT.timeout;
}

main();
