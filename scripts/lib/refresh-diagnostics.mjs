/**
 * `refresh-quotes.mjs`가 연결 실패 원인을 구분하고 복구 여부를 판단하는 데 쓰는
 * 순수 함수들. 파일 IO·네트워크 호출이 없어 실제 API 없이도 테스트할 수 있다
 * (WORK_ORDER B-0A-1).
 */

/**
 * fetch 실패 원인을 분류한다. "서버에 연결하지 못했습니다"로 전부 뭉뚱그리면
 * 실제 서버 사망, 긴 요청 중 연결 종료, 요청 자체의 timeout을 구분할 수 없다.
 * @param {unknown} error
 * @returns {string}
 */
export function classifyFetchError(error) {
  if (!error || typeof error !== "object") return "unknown";
  const name = "name" in error ? error.name : undefined;
  if (name === "TimeoutError" || name === "AbortError") return "timeout";
  const cause = "cause" in error ? error.cause : undefined;
  const code = cause && typeof cause === "object" && "code" in cause ? cause.code : undefined;
  if (code) return String(code);
  return typeof name === "string" && name ? name : "unknown";
}

/**
 * Task Scheduler의 작업 상태와 실제 HTTP 헬스체크 결과를 합쳐 사람이 읽을 진단과
 * 다음 행동을 정한다. `Running`이라는 스케줄러 상태만으로 "정상"이라고 단정하지
 * 않는다 — 이 프로젝트는 작업 상태와 실제 포트/프로세스 상태가 어긋나는 사례를
 * 여러 번 겪었다(WORK_ORDER B-0). 자동 종료·강제 재시작 범위를 넓히는 것도
 * 이번 단계의 목표가 아니다: `Running`인데 헬스체크가 실패해도 `report-only`만
 * 돌려주고, 실제 기동 시도(`start`)는 스케줄러가 `Running`이 아닐 때만 한다.
 * @param {string} taskState
 * @param {boolean} healthy
 * @returns {{ action: "none" | "report-only" | "start", message: string }}
 */
export function describeRecoveryDecision(taskState, healthy) {
  if (taskState === "Running" && healthy) {
    return { action: "none", message: `서버 작업이 "Running"이고 헬스체크도 정상 — 건드리지 않음` };
  }
  if (taskState === "Running" && !healthy) {
    return {
      action: "report-only",
      message:
        `서버 작업은 "Running"이지만 헬스체크 실패 — Task Scheduler 상태만으로는 서버가 ` +
        `살아있다고 볼 수 없습니다. 자동 종료·재시작은 하지 않고 보고만 합니다(WORK_ORDER B-0A-1).`,
    };
  }
  return { action: "start", message: `서버 작업이 "${taskState}" 상태 — Start-ScheduledTask로 기동 시도` };
}

/**
 * 갱신 호출의 종료 코드. 작업 스케줄러에 남는 `LastTaskResult`가 이 값이라,
 * 원인별로 다르게 끝나야 로그를 안 봐도 무슨 일인지 구분된다.
 */
export const REFRESH_EXIT = {
  ok: 0,
  /** 서버에 못 붙었거나, 접수/상태 조회가 거부됐다 */
  server: 1,
  /** 시세 공급자가 한 건도 주지 못했다 */
  provider: 2,
  /** 정해진 시간 안에 작업이 안 끝났다 */
  timeout: 3,
  /** 이미 갱신이 돌고 있어 이번 호출은 아무것도 하지 않았다 */
  duplicate: 4,
  /** 완료로 보고됐지만 데이터 파일이 그대로다 */
  stale: 5,
};

/**
 * 작업 상태와 파일 확인 결과로 종료 코드를 정한다. "완료 보고"만으로 성공 처리하지
 * 않고 데이터가 실제로 바뀌었는지까지 본다 — 예전에는 반대로 성공한 갱신이 실패로
 * 기록됐고, 그 반대(실패인데 성공으로 끝나는 것)도 막아야 한다.
 *
 * @param {{job: object|null, staleFiles?: string[], timedOut?: boolean}} input
 */
export function classifyJobOutcome({ job, staleFiles = [], timedOut = false }) {
  if (timedOut) return { code: REFRESH_EXIT.timeout, reason: "timeout" };
  if (!job) return { code: REFRESH_EXIT.server, reason: "unknown-job" };
  if (job.status === "running") return { code: REFRESH_EXIT.timeout, reason: "still-running" };
  if (job.status === "failed") {
    const cause = job.failure?.code;
    return { code: cause === "provider" ? REFRESH_EXIT.provider : REFRESH_EXIT.server, reason: cause ?? "unknown" };
  }
  if (staleFiles.length > 0) return { code: REFRESH_EXIT.stale, reason: "stale-data" };
  return { code: REFRESH_EXIT.ok, reason: "done" };
}
