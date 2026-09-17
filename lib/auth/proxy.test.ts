import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { proxy } from "../../proxy";
import { createSessionToken } from "./session";

beforeEach(() => {
  vi.stubEnv("AUTH_USERNAME", "owner");
  vi.stubEnv("AUTH_PASSWORD_HASH", "scrypt$v1$configured");
  vi.stubEnv("SESSION_SECRET", "a-strong-session-secret-with-more-than-32-characters");
});

afterEach(() => vi.unstubAllEnvs());

describe("화면 로그인 보호", () => {
  it("세션이 없으면 로그인 화면으로 보내고 원래 주소를 보존한다", () => {
    const response = proxy(new NextRequest("https://portfolio.example/history?range=1y"));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://portfolio.example/login?next=%2Fhistory%3Frange%3D1y",
    );
  });

  it("유효한 세션이면 화면을 통과시키고 로그인 화면에서는 원래 화면으로 보낸다", () => {
    const token = createSessionToken();
    const headers = { cookie: `cgportfolio_session=${token}` };
    const page = proxy(new NextRequest("https://portfolio.example/history", { headers }));
    expect(page.headers.get("x-middleware-next")).toBe("1");

    const login = proxy(new NextRequest("https://portfolio.example/login?next=/history", { headers }));
    expect(login.headers.get("location")).toBe("https://portfolio.example/history");
  });

  it("일반 API는 세션 없이는 401이고 크론 API는 자체 인증에 맡긴다", async () => {
    const privateApi = proxy(new NextRequest("https://portfolio.example/api/private"));
    expect(privateApi.status).toBe(401);
    await expect(privateApi.json()).resolves.toMatchObject({ ok: false });

    const cron = proxy(new NextRequest("https://portfolio.example/api/cron/refresh"));
    expect(cron.headers.get("x-middleware-next")).toBe("1");
  });

  it("production에서 인증 설정이 빠져도 공개되지 않는다", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AUTH_USERNAME", "");
    const response = proxy(new NextRequest("https://portfolio.example/"));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain("setup=1");
  });
});
