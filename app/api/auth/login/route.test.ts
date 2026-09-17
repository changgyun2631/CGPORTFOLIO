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
    expect(response.headers.get("location")).toBe("https://portfolio.example/history?range=1y");
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
    expect(response.headers.get("location")).toBe("https://portfolio.example/");
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
