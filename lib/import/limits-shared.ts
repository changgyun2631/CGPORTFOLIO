/**
 * `lib/import/limits.ts`의 검증 함수는 `server-only`라 클라이언트 컴포넌트에서
 * import할 수 없다(빌드 시점에 막힌다). 화면에 한도를 그대로 표시하려면 숫자
 * 자체는 서버·클라이언트 어느 쪽에서도 쓸 수 있어야 해서, 부작용 없는 상수와
 * `formatBytes`만 이 파일로 따로 뺐다 — 값은 `limits.ts`와 반드시 하나로
 * 맞춰서 관리한다.
 */
export const MAX_FILE_BYTES = 2 * 1024 * 1024; // 파일 하나당 2MB
export const MAX_ROWS = 5000; // 파싱된 행 수 — 보유종목·일별 기록이 이보다 많을 일은 없다
export const MAX_FILES = 3; // 계좌수익률 CSV처럼 여러 파일을 한 번에 올릴 수 있는 화면의 파일 개수 상한
export const MAX_TOTAL_BYTES = 6 * 1024 * 1024; // 합산 6MB. next.config.ts의 bodySizeLimit(8MB)보다
// 확실히 낮게 둬서, multipart 오버헤드가 붙어도 우리 쪽 친절한 오류가 프레임워크의
// 일반 오류보다 먼저 걸리게 한다.

export function formatBytes(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)}MB` : `${Math.round(bytes / 1024)}KB`;
}
