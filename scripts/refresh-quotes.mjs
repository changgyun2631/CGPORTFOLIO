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
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

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
const logPath = flags.log ?? join(homedir(), "cgportfolio-logs", "refresh.log");
const MAX_LOG_LINES = 500;

mkdirSync(dirname(logPath), { recursive: true });

function log(line) {
  const stamped = `${new Date().toISOString()} ${line}`;
  console.log(stamped);
  appendFileSync(logPath, `${stamped}\n`, "utf8");
}

/** 로그 파일이 무한정 커지지 않도록 최근 N줄만 남긴다. */
function trimLog() {
  if (!existsSync(logPath)) return;
  const lines = readFileSync(logPath, "utf8").split("\n").filter(Boolean);
  if (lines.length <= MAX_LOG_LINES) return;
  writeFileSync(logPath, `${lines.slice(-MAX_LOG_LINES).join("\n")}\n`, "utf8");
}

async function main() {
  const headers = {};
  if (secret) headers.authorization = `Bearer ${secret}`;

  log(`갱신 요청 시작 → ${url}`);

  let response;
  try {
    response = await fetch(url, { headers });
  } catch (error) {
    log(`실패: 서버에 연결하지 못했습니다 (${error.message}). 서버가 떠 있는지 확인하세요.`);
    trimLog();
    process.exitCode = 1;
    return;
  }

  const body = await response.json().catch(() => null);

  if (!response.ok || !body?.ok) {
    log(`실패: HTTP ${response.status} ${JSON.stringify(body)}`);
    trimLog();
    process.exitCode = 1;
    return;
  }

  log(
    `성공: 갱신 ${body.updated}건, 누락 ${body.missing.length}건${body.missing.length ? ` (${body.missing.join(",")})` : ""}, ` +
      `오류 ${body.errors.length}건, 총액 ${body.totalKrw?.toLocaleString?.() ?? body.totalKrw}원, ${body.elapsedMs}ms`,
  );
  trimLog();
}

main();
