import "server-only";

import { cookies } from "next/headers";

import { isAuthConfigured, SESSION_COOKIE_NAME } from "./config";
import { verifySessionToken } from "./session";

/**
 * Server Action은 Proxy 경로 설정이 바뀌어도 직접 보호한다. 개발·테스트에서 아직
 * 계정을 만들지 않은 경우만 기존 흐름을 허용하고, production은 설정 누락도 거부한다.
 */
export async function requireAuthenticatedSession(): Promise<void> {
  if (!isAuthConfigured()) {
    if (process.env.NODE_ENV === "production") throw new Error("로그인 설정이 완료되지 않았습니다.");
    return;
  }
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  if (!verifySessionToken(token)) throw new Error("로그인이 필요합니다. 다시 로그인해 주세요.");
}
