import { NextRequest, NextResponse } from "next/server";

import { isAuthConfigured, SESSION_COOKIE_NAME } from "@/lib/auth/config";
import { safeReturnPath } from "@/lib/auth/redirect";
import { verifySessionToken } from "@/lib/auth/session";

function isPublicPath(pathname: string): boolean {
  return pathname === "/login" || pathname.startsWith("/api/auth/") || pathname.startsWith("/api/cron/");
}

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const configured = isAuthConfigured();
  const validSession = configured && verifySessionToken(request.cookies.get(SESSION_COOKIE_NAME)?.value);

  if (pathname === "/login") {
    if (validSession) return NextResponse.redirect(new URL(safeReturnPath(request.nextUrl.searchParams.get("next")), request.url));
    return NextResponse.next();
  }

  if (isPublicPath(pathname)) return NextResponse.next();

  // 계정 생성 전 개발 서버는 기존처럼 쓸 수 있지만, production은 설정 누락도 닫는다.
  if (!configured && process.env.NODE_ENV !== "production") return NextResponse.next();

  if (!validSession) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ ok: false, error: "로그인이 필요합니다." }, { status: 401 });
    }
    const login = new URL("/login", request.url);
    login.searchParams.set("next", `${pathname}${search}`);
    if (!configured) login.searchParams.set("setup", "1");
    const response = NextResponse.redirect(login);
    if (request.cookies.has(SESSION_COOKIE_NAME)) response.cookies.delete(SESSION_COOKIE_NAME);
    return response;
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
