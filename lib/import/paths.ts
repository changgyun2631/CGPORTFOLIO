import "server-only";

import { statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const dataDir = join(process.cwd(), "data");

/**
 * git 워크트리(예: 개발/테스트용 체크아웃)에서는 `.git`이 gitdir을 가리키는
 * 파일이고, 원본 체크아웃에서는 디렉터리다 — 이걸로 "지금 운영 체크아웃에서
 * 도는가"를 판별한다. 2026-09-16에 워크트리에서 서버 액션(계좌 기준가 적용 등)을
 * 테스트하다가 그 쓰기-전 백업이 운영과 같은 공유 폴더(`~/cgportfolio-backups/`,
 * Task Scheduler의 일일 백업과 동일)에 시드 데이터로 섞여 들어간 사고가 있었다.
 * 워크트리에서는 대신 cwd 안의 로컬 폴더를 쓴다.
 */
function isGitWorktree(): boolean {
  try {
    return statSync(join(process.cwd(), ".git")).isFile();
  } catch {
    return false;
  }
}

export const backupRoot = isGitWorktree() ? join(process.cwd(), ".dev-backups") : join(homedir(), "cgportfolio-backups");
