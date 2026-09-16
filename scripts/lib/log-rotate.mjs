import { existsSync, readFileSync, writeFileSync } from "node:fs";

/**
 * 로그 파일이 무한정 커지지 않도록 최근 N줄만 남긴다. `refresh-quotes.mjs`가
 * 자기 로그(`refresh.log`)뿐 아니라 재시작 루프의 `server.log`도 같이
 * 정리한다 — `start-server.cmd`는 배치 파일이라 자체 회전 로직을 넣기
 * 까다롭고(한글 처리 문제로 이미 한 번 죽은 전적이 있다, WORK_ORDER B-0),
 * 이 스크립트는 6시간마다 안정적으로 돌아 별도 예약 작업 없이도 청소 역할을
 * 겸할 수 있다.
 */
export function trimLogFile(path, maxLines) {
  if (!existsSync(path)) return;
  const lines = readFileSync(path, "utf8").split("\n").filter(Boolean);
  if (lines.length <= maxLines) return;
  writeFileSync(path, `${lines.slice(-maxLines).join("\n")}\n`, "utf8");
}
