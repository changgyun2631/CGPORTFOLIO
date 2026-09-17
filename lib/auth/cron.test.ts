import { afterEach, describe, expect, it, vi } from "vitest";

import { authorizeCronRequest } from "./cron";

afterEach(() => vi.unstubAllEnvs());

describe("예약 작업 인증", () => {
  it("production에서 CRON_SECRET이 빠지면 닫힌다", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("CRON_SECRET", "");
    expect(authorizeCronRequest(new Request("http://localhost/api/cron/refresh"))).toBe(false);
  });

  it("설정된 비밀키와 정확히 같은 Bearer 요청만 허용한다", () => {
    vi.stubEnv("CRON_SECRET", "cron-secret");
    expect(authorizeCronRequest(new Request("http://localhost/api/cron/refresh"))).toBe(false);
    expect(
      authorizeCronRequest(
        new Request("http://localhost/api/cron/refresh", { headers: { authorization: "Bearer cron-secret" } }),
      ),
    ).toBe(true);
  });
});
