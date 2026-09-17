import { NextRequest, NextResponse } from "next/server";

import { SESSION_COOKIE_NAME, shouldUseSecureCookie } from "@/lib/auth/config";

export async function POST(request: NextRequest) {
  // 상대 경로로 돌려보낸다 — 이유는 lib/auth/redirect.ts의 authRedirectPath 주석 참고.
  const response = new NextResponse(null, { status: 303, headers: { Location: "/login" } });
  response.cookies.set(SESSION_COOKIE_NAME, "", {
    httpOnly: true,
    secure: shouldUseSecureCookie(request, request.nextUrl.protocol),
    sameSite: "lax",
    path: "/",
    maxAge: 0,
    expires: new Date(0),
  });
  response.headers.set("Cache-Control", "no-store");
  return response;
}
