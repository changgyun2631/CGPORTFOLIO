import "server-only";

import { scrypt as scryptCallback, timingSafeEqual } from "node:crypto";

type ParsedHash = { n: number; r: number; p: number; salt: Buffer; expected: Buffer };

/**
 * 구분자는 `.`다. `$`를 쓰면 안 된다 — `.env.local`을 읽는 dotenv가 `$v1`·`$16384`를
 * 변수 참조로 보고 지워버려서, 129자 해시가 24자로 잘린 채 로드된다. 그러면
 * `AUTH_PASSWORD_HASH` 형식 검사가 항상 실패해 로그인이 아예 불가능하다
 * (2026-09-17 실제로 그 상태였다). base64url 알파벳(A–Z a–z 0–9 - _)에는 `.`이
 * 없으므로 구분자로 안전하다.
 */
function parseHash(value: string | undefined): ParsedHash | null {
  const parts = value?.split(".") ?? [];
  if (parts.length !== 7 || parts[0] !== "scrypt" || parts[1] !== "v1") return null;
  const n = Number(parts[2]);
  const r = Number(parts[3]);
  const p = Number(parts[4]);
  if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p)) return null;
  if (n < 16_384 || n > 1_048_576 || r < 1 || r > 32 || p < 1 || p > 16) return null;
  try {
    const salt = Buffer.from(parts[5], "base64url");
    const expected = Buffer.from(parts[6], "base64url");
    return salt.length >= 16 && expected.length === 64 ? { n, r, p, salt, expected } : null;
  } catch {
    return null;
  }
}

function safeTextEqual(left: string, right: string): boolean {
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function derivePassword(password: string, parsed: ParsedHash): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(
      password,
      parsed.salt,
      parsed.expected.length,
      { N: parsed.n, r: parsed.r, p: parsed.p, maxmem: 128 * 1024 * 1024 },
      (error, derived) => (error ? reject(error) : resolve(derived)),
    );
  });
}

/** 단일 사용자 계정 검증. 실패 이유는 호출자에게 구분해 주지 않는다. */
export async function verifyCredentials(username: string, password: string): Promise<boolean> {
  const configuredUsername = process.env.AUTH_USERNAME?.trim() ?? "";
  const parsed = parseHash(process.env.AUTH_PASSWORD_HASH);
  if (!configuredUsername || !parsed || username.length > 128 || password.length > 512) return false;

  const derived = await derivePassword(password, parsed);

  return safeTextEqual(username, configuredUsername) && timingSafeEqual(derived, parsed.expected);
}
