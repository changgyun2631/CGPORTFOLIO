/** 외부 사이트로 튀는 open redirect를 막고 사이트 내부 경로만 허용한다. */
export function safeReturnPath(value: FormDataEntryValue | string | null | undefined): string {
  const path = typeof value === "string" ? value.trim() : "";
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\")) return "/";
  if (path.startsWith("/login") || path.startsWith("/api/")) return "/";
  return path;
}
