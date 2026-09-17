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
    `scrypt$v1$16384$8$1$${salt.toString("base64url")}$${derived.toString("base64url")}`,
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
