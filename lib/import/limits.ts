import "server-only";

/**
 * CSV 업로드 크기·행 수 한도. Next.js Server Action의 기본 요청 본문 한도(1MB)에만
 * 기대지 않고, 우리 쪽에서 먼저 친절한 한국어 오류로 걸러낸다 — 프레임워크가 먼저
 * 거부하면 일반적인 영문 오류만 나오고 우리 검증 로직(헤더 확인 등)까지 가지도
 * 못한다. 현재 실제 CSV는 1MB보다 훨씬 작으므로(HANDOFF.md 참고) 이 값들은
 * "정상적으로 쓰다 보면 절대 안 걸릴 만큼 넉넉하되, 잘못된 파일을 올렸을 때는
 * 빨리 알려주는" 안전판이다.
 */
export const MAX_FILE_BYTES = 2 * 1024 * 1024; // 파일 하나당 2MB
export const MAX_ROWS = 5000; // 파싱된 행 수 — 보유종목·일별 기록이 이보다 많을 일은 없다

function formatBytes(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)}MB` : `${Math.round(bytes / 1024)}KB`;
}

/** 확장자와 크기를 미리 확인한다. 파싱을 시도하기 전에 걸러서 빠르고 친절하게 실패한다. */
export function assertFileWithinLimits(file: File, label: string): void {
  if (!file.name.toLowerCase().endsWith(".csv")) {
    throw new Error(`${label}은 .csv 파일만 지원합니다 (받은 파일: ${file.name}).`);
  }
  if (file.size > MAX_FILE_BYTES) {
    throw new Error(`${label} 크기가 너무 큽니다 (${formatBytes(file.size)}, 최대 ${formatBytes(MAX_FILE_BYTES)}). 파일이 맞는지 확인하세요.`);
  }
}

/** 파싱 후 행 수가 비정상적으로 많으면 파일을 잘못 골랐을 가능성이 크다. */
export function assertRowCountWithinLimits(count: number, label: string): void {
  if (count > MAX_ROWS) {
    throw new Error(`${label} 행 수가 너무 많습니다 (${count}행, 최대 ${MAX_ROWS}행). 파일이 맞는지 확인하세요.`);
  }
}
