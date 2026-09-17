import { randomBytes, scryptSync } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { verifyCredentials } from "./password";

beforeEach(() => {
  const salt = randomBytes(16);
  const derived = scryptSync("very-strong-password", salt, 64, { N: 16_384, r: 8, p: 1, maxmem: 128 * 1024 * 1024 });
  vi.stubEnv("AUTH_USERNAME", "owner");
  vi.stubEnv(
    "AUTH_PASSWORD_HASH",
    `scrypt.v1.16384.8.1.${salt.toString("base64url")}.${derived.toString("base64url")}`,
  );
});

afterEach(() => vi.unstubAllEnvs());

describe("단일 사용자 비밀번호 검증", () => {
  it("아이디와 비밀번호가 모두 맞을 때만 통과한다", async () => {
    await expect(verifyCredentials("owner", "very-strong-password")).resolves.toBe(true);
    await expect(verifyCredentials("someone", "very-strong-password")).resolves.toBe(false);
    await expect(verifyCredentials("owner", "wrong-password")).resolves.toBe(false);
  });

  it("저장된 해시 형식이 잘못되면 안전하게 거부한다", async () => {
    vi.stubEnv("AUTH_PASSWORD_HASH", "invalid");
    await expect(verifyCredentials("owner", "very-strong-password")).resolves.toBe(false);
  });
});

describe("해시 형식 — .env.local 호환 (2026-09-17 회귀)", () => {
  it("setup-auth가 만드는 해시에 $가 들어가면 안 된다", () => {
    // `$`가 들어가면 dotenv가 `$v1`·`$16384`를 변수 참조로 확장해 값을 지워버린다.
    // 실제로 129자 해시가 24자로 잘려 로그인이 전혀 안 되는 상태였다.
    const salt = randomBytes(16);
    const derived = scryptSync("pw", salt, 64, { N: 16_384, r: 8, p: 1, maxmem: 128 * 1024 * 1024 });
    const hash = `scrypt.v1.16384.8.1.${salt.toString("base64url")}.${derived.toString("base64url")}`;

    expect(hash).not.toContain("$");
    expect(hash.startsWith("scrypt.")).toBe(true);
    // base64url에는 `.`이 없으므로 구분자가 값과 충돌하지 않는다.
    expect(hash.split(".")).toHaveLength(7);
  });
});
