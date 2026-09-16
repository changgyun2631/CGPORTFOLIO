import { describe, expect, it } from "vitest";
import { REFRESH_EXIT, classifyFetchError, classifyJobOutcome, describeRecoveryDecision } from "../refresh-diagnostics.mjs";

describe("classifyFetchError", () => {
  it("TimeoutError/AbortError는 timeout으로 분류한다", () => {
    expect(classifyFetchError(new DOMException("...", "TimeoutError"))).toBe("timeout");
    expect(classifyFetchError(new DOMException("...", "AbortError"))).toBe("timeout");
  });

  it("error.cause.code가 있으면 그 코드를 쓴다(예: ECONNREFUSED)", () => {
    const error = new Error("fetch failed");
    error.cause = { code: "ECONNREFUSED" };
    expect(classifyFetchError(error)).toBe("ECONNREFUSED");
  });

  it("cause도 없고 timeout도 아니면 error.name을 쓴다", () => {
    expect(classifyFetchError(new TypeError("something else"))).toBe("TypeError");
  });

  it("아무 정보도 없으면 unknown", () => {
    expect(classifyFetchError(undefined)).toBe("unknown");
    expect(classifyFetchError(null)).toBe("unknown");
    expect(classifyFetchError({})).toBe("unknown");
  });
});

describe("describeRecoveryDecision", () => {
  it("Running + 헬스체크 정상 → 아무것도 안 함", () => {
    expect(describeRecoveryDecision("Running", true).action).toBe("none");
  });

  it("Running + 헬스체크 실패 → 보고만 하고 자동 기동/종료는 하지 않음", () => {
    const result = describeRecoveryDecision("Running", false);
    expect(result.action).toBe("report-only");
    expect(result.message).toContain("살아있다고 볼 수 없습니다");
  });

  it("Running이 아니면(Stopped/Ready 등) 헬스체크 결과와 무관하게 기동을 시도한다", () => {
    expect(describeRecoveryDecision("Stopped", false).action).toBe("start");
    expect(describeRecoveryDecision("Ready", true).action).toBe("start");
  });
});

describe("classifyJobOutcome", () => {
  it("완료 + 파일도 갱신됐으면 성공(0)", () => {
    expect(classifyJobOutcome({ job: { status: "done" }, staleFiles: [] })).toEqual({
      code: REFRESH_EXIT.ok,
      reason: "done",
    });
  });

  it("완료 보고지만 파일이 그대로면 성공으로 치지 않는다", () => {
    const outcome = classifyJobOutcome({ job: { status: "done" }, staleFiles: ["quotes.json"] });
    expect(outcome.code).toBe(REFRESH_EXIT.stale);
    expect(outcome.reason).toBe("stale-data");
  });

  it("시세 공급자 실패와 그 밖의 실패를 다른 코드로 끝낸다", () => {
    expect(classifyJobOutcome({ job: { status: "failed", failure: { code: "provider" } } }).code).toBe(
      REFRESH_EXIT.provider,
    );
    expect(classifyJobOutcome({ job: { status: "failed", failure: { code: "write" } } }).code).toBe(
      REFRESH_EXIT.server,
    );
  });

  it("작업을 못 찾으면 서버 문제로 본다", () => {
    expect(classifyJobOutcome({ job: null }).code).toBe(REFRESH_EXIT.server);
  });

  it("정해진 시간을 넘기거나 아직도 돌고 있으면 시간 초과", () => {
    expect(classifyJobOutcome({ job: null, timedOut: true }).code).toBe(REFRESH_EXIT.timeout);
    expect(classifyJobOutcome({ job: { status: "running" } }).code).toBe(REFRESH_EXIT.timeout);
  });

  it("원인별 종료 코드가 서로 겹치지 않는다", () => {
    const codes = Object.values(REFRESH_EXIT);
    expect(new Set(codes).size).toBe(codes.length);
  });
});
