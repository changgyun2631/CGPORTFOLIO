import { describe, expect, it } from "vitest";
import { applyFinished, applyStarted, applyThrew } from "../apply-ui-state";

const preview = { token: "token-a", count: 1 };

describe("applyStarted", () => {
  it("이전 오류/성공 문구를 지우고 미리보기는 유지한다", () => {
    expect(applyStarted(preview)).toEqual({ preview, error: null, result: null });
  });
});

describe("applyFinished", () => {
  it("성공하면 미리보기를 지우고 성공 문구만 남긴다(이전 오류도 지운다)", () => {
    const state = applyFinished(preview, { ok: true, message: "반영 완료" });
    expect(state).toEqual({ preview: null, error: null, result: "반영 완료" });
  });

  it("retryToken이 있으면 미리보기를 유지하되 토큰만 바꾸고 오류를 보여준다", () => {
    const state = applyFinished(preview, { ok: false, errors: ["백업 실패"], retryToken: "token-b" });
    expect(state).toEqual({
      preview: { token: "token-b", count: 1 },
      error: "백업 실패",
      result: null,
    });
  });

  it("retryToken이 없으면(재시도해도 소용없는 실패) 미리보기를 지운다", () => {
    const state = applyFinished(preview, { ok: false, errors: ["검증 실패"] });
    expect(state).toEqual({ preview: null, error: "검증 실패", result: null });
  });

  it("오류가 여러 건이면 ' / '로 합친다", () => {
    const state = applyFinished(preview, { ok: false, errors: ["a", "b"] });
    expect(state.error).toBe("a / b");
  });
});

describe("applyThrew", () => {
  it("예외 메시지를 오류로 보여주고 미리보기를 지운다", () => {
    const state = applyThrew(new Error("네트워크 오류"));
    expect(state).toEqual({ preview: null, error: "네트워크 오류", result: null });
  });
});
