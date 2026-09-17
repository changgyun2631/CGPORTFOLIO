/**
 * 로그인 관련 리다이렉트는 **상대 경로**로 보낸다.
 *
 * 라우트 핸들러의 `request.url`은 실제 접속 호스트가 아니라 `localhost`로 정규화돼
 * 있다(Proxy의 `request.nextUrl`과 다르다). 그걸로 절대 URL을 만들면, 휴대폰에서
 * `http://192.168.x.x:3000`으로 로그인했을 때 `http://localhost:3000/...`으로
 * 돌려보내져 휴대폰 자신을 가리키게 된다 — 로그인 직후 연결 실패로 보인다.
 *
 * 상대 Location은 브라우저가 현재 출처 기준으로 해석하므로 어느 주소로 접속했든
 * 그대로 따라간다. Host 헤더를 신뢰해 절대 URL을 만들 필요도 없어진다.
 */
export function authRedirectPath(path: string, params: Record<string, string> = {}): string {
  const query = new URLSearchParams(params).toString();
  return query ? `${path}?${query}` : path;
}

/** 외부 사이트로 튀는 open redirect를 막고 사이트 내부 경로만 허용한다. */
export function safeReturnPath(value: FormDataEntryValue | string | null | undefined): string {
  const path = typeof value === "string" ? value.trim() : "";
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\")) return "/";
  if (path.startsWith("/login") || path.startsWith("/api/")) return "/";
  return path;
}
