export const SESSION_COOKIE_NAME = "cgportfolio_session";
export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

/**
 * 로그인 설정이 배포 가능한 상태인지 검사한다. 실제 값은 반환하거나 로그에
 * 남기지 않는다. Proxy와 로그인 라우트가 같은 기준을 쓰게 한 곳에 모았다.
 */
export function authConfigurationError(): string | null {
  const username = process.env.AUTH_USERNAME?.trim();
  const passwordHash = process.env.AUTH_PASSWORD_HASH?.trim();
  const sessionSecret = process.env.SESSION_SECRET?.trim();

  if (!username) return "AUTH_USERNAME이 설정되지 않았습니다.";
  // 구분자가 `.`인 이유는 lib/auth/password.ts의 parseHash 주석 참고(dotenv 변수확장).
  if (!passwordHash?.startsWith("scrypt.")) return "AUTH_PASSWORD_HASH가 설정되지 않았거나 형식이 잘못됐습니다.";
  if (!sessionSecret || sessionSecret.length < 32) return "SESSION_SECRET은 32자 이상이어야 합니다.";
  return null;
}

export function isAuthConfigured(): boolean {
  return authConfigurationError() === null;
}

/**
 * Secure 쿠키는 **연결이 HTTPS일 때만** 붙인다. 호스트 이름으로 판단하면 안 된다 —
 * `http://192.168.x.x:3000`처럼 평문 HTTP인데 Secure를 붙이면 브라우저가 쿠키를
 * 아예 저장하지 않아서, 로그인에 성공해도 곧바로 로그인 화면으로 되돌아온다.
 *
 * 리버스 프록시(예: HTTPS 종단) 뒤에 두면 `x-forwarded-proto`가 https로 오므로,
 * 나중에 HTTPS를 앞에 붙이면 코드 수정 없이 Secure가 켜진다.
 */
export function shouldUseSecureCookie(request: Request, fallbackProtocol = "http:"): boolean {
  const forwarded = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase();
  if (forwarded) return forwarded === "https";
  return fallbackProtocol === "https:";
}
