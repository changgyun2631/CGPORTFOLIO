import "server-only";

import { appendFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { trimLogFile } from "../../scripts/lib/log-rotate.mjs";

/**
 * `/api/cron/refresh`의 단계별 진행 상황을 남긴다(WORK_ORDER B-0A-1).
 *
 * 이 라우트는 `npm start`(Next.js 서버) 프로세스 안에서 실행되는데, 그 프로세스의
 * stdout은 `scripts/start-server.cmd`가 어디에도 리다이렉트하지 않아 `console.log`는
 * 아무 데도 안 남는다. 그래서 `refresh-quotes.mjs`가 밖에서 쓰는 `refresh.log`(전체
 * 성공/실패 한 줄)와 별도로, 이 라우트 "안에서" 무슨 일이 일어났는지(어느 단계에서
 * 얼마나 걸렸는지)를 직접 파일로 남긴다. 건수·소요시간·오류 종류만 쓰고 평가금액
 * 같은 민감한 값은 절대 쓰지 않는다.
 */
const LOG_DIR = join(homedir(), "cgportfolio-logs");
const LOG_PATH = join(LOG_DIR, "cron-refresh.log");
const MAX_LOG_LINES = 500;

export function logCronStage(line: string): void {
  try {
    mkdirSync(LOG_DIR, { recursive: true });
    appendFileSync(LOG_PATH, `${new Date().toISOString()} ${line}\n`, "utf8");
    trimLogFile(LOG_PATH, MAX_LOG_LINES);
  } catch {
    // 로그 실패로 갱신 자체를 막지 않는다 — 최선의 노력이다.
  }
}
