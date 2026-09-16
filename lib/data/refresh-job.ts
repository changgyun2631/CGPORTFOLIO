import "server-only";

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * 시세 갱신 작업의 진행 상태.
 *
 * 갱신은 7분쯤 걸리는데, 예전에는 호출 스크립트가 그 시간 내내 HTTP 응답 하나를
 * 붙잡고 기다렸다. Undici의 `headersTimeout`이 5분이라 **정상 성공한 갱신도**
 * 스크립트에서는 `UND_ERR_HEADERS_TIMEOUT`으로 끊겼고, 작업 스케줄러에는
 * `LastTaskResult=1`(실패)로 남았다. `AbortSignal`을 늘려도 `headersTimeout`은
 * 그대로라 해결되지 않는다.
 *
 * 그래서 긴 연결 자체를 없앴다. 시작 요청은 접수만 하고 바로 `jobId`를 돌려주며,
 * 스크립트는 짧은 상태 조회를 반복한다. 요청 하나하나가 수 초라 타임아웃 한도에
 * 걸릴 일이 없다.
 *
 * 상태는 메모리에 두고 파일로도 남긴다. 파일이 있어야 서버가 중간에 재시작해도
 * 스크립트가 "그 작업이 어떻게 끝났는지 알 수 없다"는 것을 구분할 수 있다.
 * 민감한 값(평가금액 등)은 남기지 않는다 — 건수·소요시간·원인 코드만 쓴다.
 */

export type RefreshFailureCode = "provider" | "write" | "unknown";

export type RefreshJob = {
  jobId: string;
  status: "running" | "done" | "failed";
  startedAt: string;
  stage: string;
  finishedAt?: string;
  elapsedMs?: number;
  updated?: number;
  missingCount?: number;
  errorCount?: number;
  failure?: { code: RefreshFailureCode; provider?: string; message: string };
};

const STATE_DIR = join(homedir(), "cgportfolio-logs");
const STATE_PATH = join(STATE_DIR, "refresh-job.json");

let currentJob: RefreshJob | null = null;

function persist(job: RefreshJob): void {
  try {
    mkdirSync(STATE_DIR, { recursive: true });
    writeFileSync(STATE_PATH, `${JSON.stringify(job, null, 2)}\n`, "utf8");
  } catch {
    // 상태 파일을 못 써도 갱신 자체는 계속한다 — 메모리 상태로 응답할 수 있다.
  }
}

function readPersisted(): RefreshJob | null {
  try {
    return JSON.parse(readFileSync(STATE_PATH, "utf8")) as RefreshJob;
  } catch {
    return null;
  }
}

/** 지금 돌고 있는 작업. 없으면 null. */
export function runningJob(): RefreshJob | null {
  return currentJob?.status === "running" ? currentJob : null;
}

/**
 * 새 작업을 연다. 이미 도는 작업이 있으면 `null` — 호출한 쪽이 409로 돌려보내
 * 중복 쓰기가 시작되지 않게 한다(`withDataLock`은 쓰기 단계만 막으므로, 그 앞의
 * 외부 API 호출까지 두 벌 도는 것을 여기서 막는다).
 */
export function beginJob(): RefreshJob | null {
  if (runningJob()) return null;
  currentJob = {
    jobId: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    status: "running",
    startedAt: new Date().toISOString(),
    stage: "시작",
  };
  persist(currentJob);
  return currentJob;
}

export function markStage(jobId: string, stage: string): void {
  if (currentJob?.jobId !== jobId) return;
  currentJob = { ...currentJob, stage };
  persist(currentJob);
}

export function finishJob(
  jobId: string,
  result: { updated: number; missingCount: number; errorCount: number },
): void {
  if (currentJob?.jobId !== jobId) return;
  currentJob = {
    ...currentJob,
    ...result,
    status: "done",
    stage: "완료",
    finishedAt: new Date().toISOString(),
    elapsedMs: Date.now() - Date.parse(currentJob.startedAt),
  };
  persist(currentJob);
}

export function failJob(jobId: string, failure: RefreshJob["failure"]): void {
  if (currentJob?.jobId !== jobId) return;
  currentJob = {
    ...currentJob,
    status: "failed",
    stage: "중단",
    failure,
    finishedAt: new Date().toISOString(),
    elapsedMs: Date.now() - Date.parse(currentJob.startedAt),
  };
  persist(currentJob);
}

/**
 * 상태 조회. 메모리에 없으면 파일에서 읽는다 — 서버가 재시작한 뒤에도 마지막
 * 결과는 알 수 있다. 파일에 `running`으로 남아 있는데 메모리에 없으면 그 작업은
 * 서버와 함께 죽은 것이므로 `failed`로 본다.
 */
export function readJob(jobId: string): RefreshJob | null {
  if (currentJob?.jobId === jobId) return currentJob;
  const persisted = readPersisted();
  if (persisted?.jobId !== jobId) return null;
  if (persisted.status === "running") {
    return {
      ...persisted,
      status: "failed",
      failure: { code: "unknown", message: "작업이 끝나기 전에 서버가 다시 시작된 것으로 보입니다." },
    };
  }
  return persisted;
}
