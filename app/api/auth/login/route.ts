import { NextRequest, NextResponse } from "next/server";

import { authConfigurationError, SESSION_COOKIE_NAME, SESSION_TTL_SECONDS, shouldUseSecureCookie } from "@/lib/auth/config";
import { verifyCredentials } from "@/lib/auth/password";
import { clearLoginFailures, loginAttemptAllowed, loginRetryAfterSeconds, recordLoginFailure } from "@/lib/auth/rate-limit";
import { authRedirectPath, safeReturnPath } from "@/lib/auth/redirect";
import { createSessionToken } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

function clientKey(request: NextRequest): string {
  return request.headers.get("x-real-ip") ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
}

/** 상대 경로로 돌려보낸다 — 이유는 lib/auth/redirect.ts의 authRedirectPath 주석 참고. */
function redirectTo(path: string): NextResponse {
  const response = new NextResponse(null, { status: 303, headers: { Location: path } });
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export async function POST(request: NextRequest) {
  const setupError = authConfigurationError();
  if (setupError) return redirectTo(authRedirectPath("/login", { setup: "1" }));

  const key = clientKey(request);
  if (!loginAttemptAllowed(key)) {
    const response = redirectTo(authRedirectPath("/login", { error: "rate" }));
    response.headers.set("Retry-After", String(loginRetryAfterSeconds(key)));
    return response;
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return redirectTo(authRedirectPath("/login", { error: "invalid" }));
  }

  const username = String(formData.get("username") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const next = safeReturnPath(formData.get("next"));

  if (!(await verifyCredentials(username, password))) {
    recordLoginFailure(key);
    return redirectTo(authRedirectPath("/login", { error: "invalid", next }));
  }

  clearLoginFailures(key);
  const response = redirectTo(next);
  response.cookies.set(SESSION_COOKIE_NAME, createSessionToken(), {
    httpOnly: true,
    secure: shouldUseSecureCookie(request, request.nextUrl.protocol),
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
    expires: new Date(Date.now() + SESSION_TTL_SECONDS * 1000),
    priority: "high",
  });
  response.headers.set("Cache-Control", "no-store");
  return response;
}
