import { describe, expect, it } from "vitest";

import { clearLoginFailures, loginAttemptAllowed, loginRetryAfterSeconds, recordLoginFailure } from "./rate-limit";

describe("로그인 실패 제한", () => {
  it("15분 동안 5회 실패 뒤 차단하고 시간이 지나면 푼다", () => {
    const key = `test-${crypto.randomUUID()}`;
    const now = 1_700_000_000_000;
    for (let i = 0; i < 5; i += 1) {
      expect(loginAttemptAllowed(key, now)).toBe(true);
      recordLoginFailure(key, now);
    }
    expect(loginAttemptAllowed(key, now)).toBe(false);
    expect(loginRetryAfterSeconds(key, now)).toBe(15 * 60);
    expect(loginAttemptAllowed(key, now + 15 * 60 * 1000)).toBe(true);
  });

  it("성공하면 이전 실패 기록을 지운다", () => {
    const key = `test-${crypto.randomUUID()}`;
    recordLoginFailure(key);
    clearLoginFailures(key);
    expect(loginAttemptAllowed(key)).toBe(true);
  });
});
