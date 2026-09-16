import { describe, expect, it } from "vitest";
import { classifyFetchError, describeRecoveryDecision } from "../refresh-diagnostics.mjs";

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
