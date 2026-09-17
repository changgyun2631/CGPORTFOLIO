import { NextRequest, NextResponse } from "next/server";

import { authConfigurationError, SESSION_COOKIE_NAME, SESSION_TTL_SECONDS, shouldUseSecureCookie } from "@/lib/auth/config";
import { verifyCredentials } from "@/lib/auth/password";
import { clearLoginFailures, loginAttemptAllowed, loginRetryAfterSeconds, recordLoginFailure } from "@/lib/auth/rate-limit";
import { safeReturnPath } from "@/lib/auth/redirect";
import { createSessionToken } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

function clientKey(request: NextRequest): string {
  return request.headers.get("x-real-ip") ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
}

function loginRedirect(request: NextRequest, params: Record<string, string>): URL {
  const url = new URL("/login", request.url);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url;
}

export async function POST(request: NextRequest) {
  const setupError = authConfigurationError();
  if (setupError) return NextResponse.redirect(loginRedirect(request, { setup: "1" }), 303);

  const key = clientKey(request);
  if (!loginAttemptAllowed(key)) {
    const response = NextResponse.redirect(loginRedirect(request, { error: "rate" }), 303);
    response.headers.set("Retry-After", String(loginRetryAfterSeconds(key)));
    return response;
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.redirect(loginRedirect(request, { error: "invalid" }), 303);
  }

  const username = String(formData.get("username") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const next = safeReturnPath(formData.get("next"));

  if (!(await verifyCredentials(username, password))) {
    recordLoginFailure(key);
    return NextResponse.redirect(loginRedirect(request, { error: "invalid", next }), 303);
  }

  clearLoginFailures(key);
  const response = NextResponse.redirect(new URL(next, request.url), 303);
  response.cookies.set(SESSION_COOKIE_NAME, createSessionToken(), {
    httpOnly: true,
    secure: shouldUseSecureCookie(request.nextUrl),
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
    expires: new Date(Date.now() + SESSION_TTL_SECONDS * 1000),
    priority: "high",
  });
  response.headers.set("Cache-Control", "no-store");
  return response;
}
