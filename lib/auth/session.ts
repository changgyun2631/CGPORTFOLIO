import { createHmac, timingSafeEqual } from "node:crypto";

import { SESSION_TTL_SECONDS } from "./config";

type SessionPayload = {
  v: 1;
  sub: "owner";
  iat: number;
  exp: number;
};

function sessionSecret(): string | null {
  const value = process.env.SESSION_SECRET?.trim();
  return value && value.length >= 32 ? value : null;
}

function sign(encodedPayload: string, secret: string): string {
  return createHmac("sha256", secret).update(`v1.${encodedPayload}`).digest("base64url");
}

/** 비밀번호나 금융정보를 넣지 않는 최소 세션 토큰. 로그인 시점부터 정확히 7일간 유효하다. */
export function createSessionToken(nowMs = Date.now()): string {
  const secret = sessionSecret();
  if (!secret) throw new Error("로그인 세션 비밀키가 설정되지 않았습니다.");

  const iat = Math.floor(nowMs / 1000);
  const payload: SessionPayload = { v: 1, sub: "owner", iat, exp: iat + SESSION_TTL_SECONDS };
  const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `v1.${encodedPayload}.${sign(encodedPayload, secret)}`;
}

export function verifySessionToken(token: string | null | undefined, nowMs = Date.now()): boolean {
  const secret = sessionSecret();
  if (!secret || !token) return false;

  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== "v1") return false;
  const [, encodedPayload, signature] = parts;

  try {
    const expected = Buffer.from(sign(encodedPayload, secret), "base64url");
    const received = Buffer.from(signature, "base64url");
    if (expected.length !== received.length || !timingSafeEqual(expected, received)) return false;

    const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as Partial<SessionPayload>;
    const now = Math.floor(nowMs / 1000);
    if (payload.v !== 1 || payload.sub !== "owner") return false;
    if (!Number.isInteger(payload.iat) || !Number.isInteger(payload.exp)) return false;
    if (payload.iat! > now + 300 || payload.exp! <= now) return false;
    // 조작된 장기 토큰은 서명이 맞더라도 정책상 거부한다. 정상 토큰은 정확히 7일이다.
    if (payload.exp! - payload.iat! !== SESSION_TTL_SECONDS) return false;
    return true;
  } catch {
    return false;
  }
}
