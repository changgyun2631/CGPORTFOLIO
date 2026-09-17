/**
 * `/api/cron/weekly-report`를 호출해 그 주의 노출 리포트를 남기고 로그를 쓴다.
 *
 * 계산은 서버 쪽 라우트가 한다 — 화면과 같은 함수(`lib/domain/exposure.ts`)를
 * 쓰려는 것이다. 여기서 다시 구현하면 화면과 리포트의 숫자가 언젠가 갈라진다
 * (`scripts/refresh-quotes.mjs`와 같은 구조).
 *
 *   node scripts/generate-weekly-report.mjs
 *     [--url=http://localhost:3000/api/cron/weekly-report]
 *     [--secret=<CRON_SECRET>] [--log=<로그 경로>]
 *
 * 주기 실행: 작업 스케줄러에 주 1회로 등록한다. 서버가 떠 있어야 하므로
 * "CGPORTFOLIO 서버" 작업이 돌아가는 시간대에 맞춘다.
 */
import { appendFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { trimLogFile } from "./lib/log-rotate.mjs";
import { loadLocalEnv } from "./lib/load-local-env.mjs";

loadLocalEnv();

const REQUEST_TIMEOUT_MS = 60_000;

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
const url = flags.url ?? "http://localhost:3000/api/cron/weekly-report";
const secret = flags.secret ?? process.env.CRON_SECRET ?? "";
const logPath = flags.log ?? join(homedir(), "cgportfolio-logs", "weekly-report.log");

function log(message) {
  const line = `${new Date().toISOString()} ${message}\n`;
  try {
    mkdirSync(dirname(logPath), { recursive: true });
    appendFileSync(logPath, line);
    trimLogFile(logPath);
  } catch {
    // 로그를 못 써도 작업 자체는 계속한다.
  }
  process.stdout.write(line);
}

async function attempt() {
  const response = await fetch(url, {
    headers: secret ? { authorization: `Bearer ${secret}` } : undefined,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body?.ok) throw new Error(`HTTP ${response.status} ${body?.error ?? ""}`.trim());
  return body;
}

async function main() {
  // 원자적 쓰기의 rename이 Windows에서 가끔 EPERM으로 튕긴다(다른 프로세스가
  // 그 파일을 잠깐 잡고 있을 때). 주 1회짜리 작업이라 한 번 튕기면 그 주 기록이
  // 통째로 비므로, 짧게 한 번 더 시도한다.
  try {
    return await attempt();
  } catch (error) {
    log(`1차 실패 — ${error.message} · 5초 뒤 재시도`);
    await new Promise((resolve) => setTimeout(resolve, 5_000));
    return attempt();
  }
}

main()
  .then((body) => log(`완료 — ${body.slug} (보관 ${body.total}건)`))
  .catch((error) => {
    log(`실패 — ${error.message}`);
    process.exit(1);
  });
