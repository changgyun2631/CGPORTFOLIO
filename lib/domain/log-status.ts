/**
 * `server.log`/`refresh.log` 텍스트를 진단용 요약으로 바꾼다. 로그 파일을 직접
 * 읽지 않는 순수 함수라 테스트에 실제 파일이 필요 없다 — 읽기는 `lib/status/`가
 * 담당한다.
 *
 * 두 로그 모두 시스템 로컬 시계를 쓰는데, 이 운영 환경에서는 그 시계 자체가
 * "UTC"로 취급된다(WORK_ORDER.md 0-4절 참고) — `server.log`의 `%date% %time%`
 * 형식도 `Date.UTC`로 만들어서 `refresh.log`의 ISO(진짜 UTC) 타임스탬프와 같은
 * 축에서 비교되게 한다.
 */

export type ServerLogEvent = { at: string; type: "starting" | "exited" };

export type ServerLogSummary = {
  /** 로그에서 실제로 읽어낸 이벤트 수(정렬됨, 오래된 것부터) */
  events: ServerLogEvent[];
  /** now 기준 최근 24시간 안의 "다시 시작" 횟수 — 정상 가동 중 하루 0~1회가 기준(WORK_ORDER B-0) */
  restartsLast24h: number;
  lastStartedAt: string | null;
  /** 10분 안에 3회 이상 재시작 — 크래시 루프 의심 신호 */
  rapidRestartWarning: boolean;
};

const SERVER_LOG_LINE = /^(\d{4})-(\d{2})-(\d{2})\s+(\d{1,2}):(\d{2}):(\d{2})\.(\d{2})\s+(server starting|server exited, restarting in \d+s)\s*$/;

function toUtcIso(year: string, month: string, day: string, hour: string, minute: string, second: string, centisecond: string): string {
  const ms = Number(centisecond) * 10;
  const date = new Date(
    Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second), ms),
  );
  return date.toISOString();
}

export function parseServerLog(text: string, now: Date): ServerLogSummary {
  const events: ServerLogEvent[] = [];
  for (const line of text.split("\n")) {
    const match = SERVER_LOG_LINE.exec(line.trim());
    if (!match) continue;
    const [, year, month, day, hour, minute, second, centisecond, label] = match;
    events.push({
      at: toUtcIso(year, month, day, hour, minute, second, centisecond),
      type: label.startsWith("server starting") ? "starting" : "exited",
    });
  }
  events.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));

  const startEvents = events.filter((e) => e.type === "starting");
  const cutoff = now.getTime() - 24 * 60 * 60 * 1000;
  const restartsLast24h = startEvents.filter((e) => Date.parse(e.at) >= cutoff).length;
  const lastStartedAt = startEvents.at(-1)?.at ?? null;

  // 10분 창 안에 시작 이벤트가 3개 이상이면 크래시 루프로 본다.
  let rapidRestartWarning = false;
  for (let i = 0; i + 2 < startEvents.length; i += 1) {
    const spanMs = Date.parse(startEvents[i + 2].at) - Date.parse(startEvents[i].at);
    if (spanMs <= 10 * 60 * 1000) {
      rapidRestartWarning = true;
      break;
    }
  }

  return { events, restartsLast24h, lastStartedAt, rapidRestartWarning };
}

export type RefreshLogEntry = {
  at: string;
  status: "success" | "failure";
  updated?: number;
  missing?: number;
  errors?: number;
  reason?: string;
};

export type RefreshLogSummary = {
  entries: RefreshLogEntry[];
  lastSuccess: RefreshLogEntry | null;
  lastFailure: RefreshLogEntry | null;
  /** 최근 8회(하루 4회 주기 기준 이틀치) 중 실패 횟수 */
  recentFailureCount: number;
  recentTotal: number;
};

const SUCCESS_LINE = /^(\S+) 성공: 갱신 (\d+)건, 누락 (\d+)건(?: \([^)]*\))?, 오류 (\d+)건/;
const FAILURE_LINE = /^(\S+) 실패: (.+)$/;

export function parseRefreshLog(text: string): RefreshLogSummary {
  const entries: RefreshLogEntry[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    const success = SUCCESS_LINE.exec(trimmed);
    if (success) {
      const [, at, updated, missing, errors] = success;
      entries.push({ at, status: "success", updated: Number(updated), missing: Number(missing), errors: Number(errors) });
      continue;
    }
    const failure = FAILURE_LINE.exec(trimmed);
    if (failure) {
      const [, at, reason] = failure;
      entries.push({ at, status: "failure", reason });
    }
  }
  entries.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));

  const recent = entries.slice(-8);
  return {
    entries,
    lastSuccess: [...entries].reverse().find((e) => e.status === "success") ?? null,
    lastFailure: [...entries].reverse().find((e) => e.status === "failure") ?? null,
    recentFailureCount: recent.filter((e) => e.status === "failure").length,
    recentTotal: recent.length,
  };
}

/**
 * 등록된 고정 시각(UTC 시) 스케줄 중 `now` 다음으로 오는 시각을 계산한다.
 * 작업 스케줄러를 조회하지 않는 순수 계산이다 — 문서화된 스케줄(WORK_ORDER
 * 0-3절: 시세 갱신 02/08/14/20시, 서버 기동 04시)을 그대로 반영한다. 스케줄이
 * 바뀌면 이 값도 같이 고쳐야 한다.
 */
export function nextScheduledRun(now: Date, hoursUtc: number[]): string {
  const sorted = [...hoursUtc].sort((a, b) => a - b);
  const base = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  for (const hour of sorted) {
    const candidate = new Date(base.getTime() + hour * 60 * 60 * 1000);
    if (candidate.getTime() > now.getTime()) return candidate.toISOString();
  }
  // 오늘 남은 시각이 없으면 내일 첫 시각.
  const tomorrow = new Date(base.getTime() + 24 * 60 * 60 * 1000);
  return new Date(tomorrow.getTime() + sorted[0] * 60 * 60 * 1000).toISOString();
}
