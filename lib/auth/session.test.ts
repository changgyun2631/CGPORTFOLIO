import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SESSION_TTL_SECONDS } from "./config";
import { createSessionToken, verifySessionToken } from "./session";

const NOW = 1_700_000_000_000;

beforeEach(() => {
  vi.stubEnv("SESSION_SECRET", "a-strong-session-secret-with-more-than-32-characters");
});

afterEach(() => vi.unstubAllEnvs());

describe("7일 로그인 세션", () => {
  it("발급 직후와 만료 직전에는 유효하고 정확히 7일 뒤에는 만료된다", () => {
    const token = createSessionToken(NOW);
    expect(verifySessionToken(token, NOW)).toBe(true);
    expect(verifySessionToken(token, NOW + SESSION_TTL_SECONDS * 1000 - 1)).toBe(true);
    expect(verifySessionToken(token, NOW + SESSION_TTL_SECONDS * 1000)).toBe(false);
  });

  it("내용이나 서명이 바뀐 토큰은 거부한다", () => {
    const token = createSessionToken(NOW);
    const [version, payload, signature] = token.split(".");
    expect(verifySessionToken(`${version}.${payload}x.${signature}`, NOW)).toBe(false);
    expect(verifySessionToken(`${version}.${payload}.${signature.slice(0, -1)}x`, NOW)).toBe(false);
  });

  it("비밀키가 바뀌거나 토큰 형식이 잘못되면 거부한다", () => {
    const token = createSessionToken(NOW);
    vi.stubEnv("SESSION_SECRET", "another-strong-session-secret-more-than-32-characters");
    expect(verifySessionToken(token, NOW)).toBe(false);
    expect(verifySessionToken("not-a-session", NOW)).toBe(false);
  });
});
