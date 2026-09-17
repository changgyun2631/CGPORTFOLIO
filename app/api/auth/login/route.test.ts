import { randomBytes, scryptSync } from "node:crypto";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { POST as login } from "./route";
import { POST as logout } from "../logout/route";

function request(fields: Record<string, string>, ip = crypto.randomUUID()) {
  return new NextRequest("https://portfolio.example/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", "x-real-ip": ip },
    body: new URLSearchParams(fields),
  });
}

beforeEach(() => {
  const salt = randomBytes(16);
  const derived = scryptSync("very-strong-password", salt, 64, { N: 16_384, r: 8, p: 1, maxmem: 128 * 1024 * 1024 });
  vi.stubEnv("AUTH_USERNAME", "owner");
  vi.stubEnv(
    "AUTH_PASSWORD_HASH",
    `scrypt.v1.16384.8.1.${salt.toString("base64url")}.${derived.toString("base64url")}`,
  );
  vi.stubEnv("SESSION_SECRET", "a-strong-session-secret-with-more-than-32-characters");
});

afterEach(() => vi.unstubAllEnvs());

describe("POST /api/auth/login", () => {
  it("올바른 계정이면 7일 HttpOnly 쿠키를 만들고 원래 화면으로 돌려보낸다", async () => {
    const response = await login(
      request({ username: "owner", password: "very-strong-password", next: "/history?range=1y" }),
    );
    const cookie = response.headers.get("set-cookie") ?? "";
    expect(response.status).toBe(303);
    // 상대 경로여야 한다 — 접속한 호스트를 그대로 따라가게 하려는 것이다.
    expect(response.headers.get("location")).toBe("/history?range=1y");
    expect(cookie).toContain("cgportfolio_session=");
    expect(cookie).toContain("Max-Age=604800");
    expect(cookie).toContain("Path=/");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=lax");
  });

  it("틀린 비밀번호는 쿠키를 만들지 않고 같은 오류만 보여준다", async () => {
    const response = await login(request({ username: "owner", password: "wrong", next: "/" }));
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toContain("error=invalid");
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("외부 next 주소는 무시한다", async () => {
    const response = await login(
      request({ username: "owner", password: "very-strong-password", next: "https://evil.example" }),
    );
    expect(response.headers.get("location")).toBe("/");
  });
});

describe("POST /api/auth/logout", () => {
  it("세션 쿠키를 즉시 지운다", async () => {
    const response = await logout(new NextRequest("https://portfolio.example/api/auth/logout", { method: "POST" }));
    const cookie = response.headers.get("set-cookie") ?? "";
    expect(response.status).toBe(303);
    expect(cookie).toContain("cgportfolio_session=");
    expect(cookie).toContain("Max-Age=0");
  });
});

describe("휴대폰·LAN 접속 회귀 (2026-09-17)", () => {
  function requestOn(url: string, fields: Record<string, string>, headers: Record<string, string> = {}) {
    return new NextRequest(url, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-real-ip": crypto.randomUUID(),
        ...headers,
      },
      body: new URLSearchParams(fields),
    });
  }

  it("리다이렉트는 절대 URL이 아니라 상대 경로다", async () => {
    // 라우트 핸들러의 request.url은 실제 접속 호스트가 아니라 localhost로 정규화된다.
    // 절대 URL로 돌려보내면 휴대폰에서 로그인했을 때 휴대폰 자신(localhost)을 가리킨다.
    const response = await login(
      requestOn("http://192.168.10.72:3000/api/auth/login", {
        username: "owner",
        password: "very-strong-password",
      }),
    );
    const location = response.headers.get("location") ?? "";
    expect(location.startsWith("/")).toBe(true);
    expect(location).not.toContain("localhost");
    expect(location).not.toContain("://");
  });

  it("평문 HTTP에서는 Secure 쿠키를 붙이지 않는다", async () => {
    // Secure를 붙이면 브라우저가 HTTP 응답의 쿠키를 저장하지 않아, 로그인해도
    // 곧바로 로그인 화면으로 되돌아온다.
    const response = await login(
      requestOn("http://192.168.10.72:3000/api/auth/login", {
        username: "owner",
        password: "very-strong-password",
      }),
    );
    const cookie = response.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("HttpOnly");
    expect(cookie).not.toMatch(/;\s*Secure/i);
  });

  it("x-forwarded-proto가 https면 Secure 쿠키를 붙인다", async () => {
    // 나중에 HTTPS 리버스 프록시를 앞에 두면 코드 수정 없이 Secure가 켜져야 한다.
    const response = await login(
      requestOn(
        "http://192.168.10.72:3000/api/auth/login",
        { username: "owner", password: "very-strong-password" },
        { "x-forwarded-proto": "https" },
      ),
    );
    expect(response.headers.get("set-cookie") ?? "").toMatch(/;\s*Secure/i);
  });
});
