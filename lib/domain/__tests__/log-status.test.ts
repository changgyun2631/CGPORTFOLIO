import { describe, expect, it } from "vitest";

import { nextScheduledRun, parseRefreshLog, parseServerLog } from "../log-status";

describe("parseServerLog", () => {
  it("실제 로그 형식(공백 1~2칸, 한 자리/두 자리 시)을 파싱한다", () => {
    const text = [
      "2026-09-16  4:15:39.18 server starting ",
      "2026-09-16  4:58:03.46 server exited, restarting in 10s ",
      "2026-09-16  4:58:13.17 server starting ",
      "2026-09-16 10:24:13.61 server starting ",
    ].join("\n");
    const summary = parseServerLog(text, new Date("2026-09-16T10:30:00Z"));
    expect(summary.events).toHaveLength(4);
    expect(summary.events[0]).toEqual({ at: "2026-09-16T04:15:39.180Z", type: "starting" });
    expect(summary.lastStartedAt).toBe("2026-09-16T10:24:13.610Z");
  });

  it("24시간 안의 재시작만 센다", () => {
    const text = ["2026-09-14  0:00:00.00 server starting ", "2026-09-16  9:00:00.00 server starting "].join("\n");
    const summary = parseServerLog(text, new Date("2026-09-16T10:00:00Z"));
    expect(summary.restartsLast24h).toBe(1);
  });

  it("10분 안에 3번 이상 재시작하면 크래시 루프로 경고한다", () => {
    const text = [
      "2026-09-16  9:00:00.00 server starting ",
      "2026-09-16  9:00:10.00 server exited, restarting in 10s ",
      "2026-09-16  9:00:20.00 server starting ",
      "2026-09-16  9:00:30.00 server exited, restarting in 10s ",
      "2026-09-16  9:00:40.00 server starting ",
    ].join("\n");
    const summary = parseServerLog(text, new Date("2026-09-16T09:01:00Z"));
    expect(summary.rapidRestartWarning).toBe(true);
  });

  it("재시작 간격이 넓으면 경고하지 않는다", () => {
    const text = [
      "2026-09-16  4:00:00.00 server starting ",
      "2026-09-16  6:00:00.00 server starting ",
      "2026-09-16  8:00:00.00 server starting ",
    ].join("\n");
    const summary = parseServerLog(text, new Date("2026-09-16T09:00:00Z"));
    expect(summary.rapidRestartWarning).toBe(false);
  });

  it("빈 로그는 전부 비어 있다", () => {
    const summary = parseServerLog("", new Date("2026-09-16T10:00:00Z"));
    expect(summary.events).toEqual([]);
    expect(summary.restartsLast24h).toBe(0);
    expect(summary.lastStartedAt).toBeNull();
    expect(summary.rapidRestartWarning).toBe(false);
  });

  it("형식에 안 맞는 줄은 조용히 무시한다", () => {
    const summary = parseServerLog("이건 로그 줄이 아님\n\n", new Date("2026-09-16T10:00:00Z"));
    expect(summary.events).toEqual([]);
  });
});

describe("parseRefreshLog", () => {
  it("성공 로그에서 금액 없이 건수만 뽑는다", () => {
    // 옛 형식(P2-10 이전)에는 "총액 ...원"이 남아 있었다 — 실제 사용자 데이터가
    // 아닌 임의의 값으로 그 구형 줄 모양을 재현해, 파싱 결과에 금액이 안 섞여
    // 나오는지 확인한다.
    const text = "2026-09-15T17:03:11.994Z 성공: 갱신 30건, 누락 0건, 오류 0건, 총액 1,234,567원, 189589ms";
    const summary = parseRefreshLog(text);
    expect(summary.lastSuccess).toEqual({
      at: "2026-09-15T17:03:11.994Z",
      status: "success",
      updated: 30,
      missing: 0,
      errors: 0,
    });
    // 파싱 결과 어디에도 금액 문자열이 들어있지 않아야 한다(민감 값 제거 확인).
    expect(JSON.stringify(summary)).not.toContain("1,234,567");
  });

  it("누락 심볼 목록이 있어도 건수를 정확히 뽑는다", () => {
    const text = "2026-09-15T17:03:11.994Z 성공: 갱신 28건, 누락 2건 (QLD,TQQQ), 오류 0건, 191234ms";
    const summary = parseRefreshLog(text);
    expect(summary.lastSuccess?.missing).toBe(2);
  });

  it("실패 로그에서 사유를 뽑는다", () => {
    const text = "2026-09-15T23:05:04.603Z 실패: 서버에 연결하지 못했습니다 (fetch failed). 서버가 떠 있는지 확인하세요.";
    const summary = parseRefreshLog(text);
    expect(summary.lastFailure?.reason).toContain("서버에 연결하지 못했습니다");
  });

  it("마지막 성공/실패를 각각 따로 찾는다(시간순 섞여 있어도)", () => {
    const text = [
      "2026-09-15T11:00:00.000Z 성공: 갱신 30건, 누락 0건, 오류 0건, 100ms",
      "2026-09-15T17:00:00.000Z 실패: 서버에 연결하지 못했습니다.",
      "2026-09-15T23:00:00.000Z 성공: 갱신 30건, 누락 0건, 오류 0건, 100ms",
    ].join("\n");
    const summary = parseRefreshLog(text);
    expect(summary.lastSuccess?.at).toBe("2026-09-15T23:00:00.000Z");
    expect(summary.lastFailure?.at).toBe("2026-09-15T17:00:00.000Z");
  });

  it("최근 8회 중 실패 횟수를 센다", () => {
    const entries = Array.from({ length: 10 }, (_, i) => {
      const at = new Date(Date.UTC(2026, 0, 1, i)).toISOString();
      return i % 3 === 0
        ? `${at} 실패: 서버에 연결하지 못했습니다.`
        : `${at} 성공: 갱신 30건, 누락 0건, 오류 0건, 100ms`;
    });
    const summary = parseRefreshLog(entries.join("\n"));
    // 최근 8개(인덱스 2~9)에서 실패(i%3===0)는 3,6,9 → 3건
    expect(summary.recentTotal).toBe(8);
    expect(summary.recentFailureCount).toBe(3);
  });

  it("빈 로그는 전부 null/0이다", () => {
    const summary = parseRefreshLog("");
    expect(summary.lastSuccess).toBeNull();
    expect(summary.lastFailure).toBeNull();
    expect(summary.recentTotal).toBe(0);
  });
});

describe("nextScheduledRun", () => {
  const hours = [2, 8, 14, 20];

  it("같은 날 다음 시각을 고른다", () => {
    expect(nextScheduledRun(new Date("2026-09-16T05:00:00Z"), hours)).toBe("2026-09-16T08:00:00.000Z");
  });

  it("마지막 시각을 지났으면 다음날 첫 시각을 고른다", () => {
    expect(nextScheduledRun(new Date("2026-09-16T21:00:00Z"), hours)).toBe("2026-09-17T02:00:00.000Z");
  });

  it("정각 그 순간엔 다음 시각으로 넘어간다(같은 시각을 다시 고르지 않음)", () => {
    expect(nextScheduledRun(new Date("2026-09-16T08:00:00.000Z"), hours)).toBe("2026-09-16T14:00:00.000Z");
  });

  it("정렬 안 된 입력도 정렬해서 처리한다", () => {
    expect(nextScheduledRun(new Date("2026-09-16T05:00:00Z"), [20, 2, 14, 8])).toBe("2026-09-16T08:00:00.000Z");
  });
});
