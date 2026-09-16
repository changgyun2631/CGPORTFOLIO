/**
 * data/ 백업.
 *
 * data/*.json 은 개인 금융 정보라 gitignore로 빠져 있다 — git이 지켜주지 않는다.
 * 이 스크립트는 data/ 전체를 타임스탬프 폴더로 복사해 저장소 밖(기본값:
 * 사용자 홈 아래 cgportfolio-backups)에 남긴다. 최근 N개만 남기고 오래된
 * 백업은 정리한다.
 *
 * 실제 복사·정리 로직은 `scripts/lib/backup.mjs`(순수 함수에 가까운 유틸)에
 * 있다 — 웹 가져오기 화면의 "적용 직전 자동 백업"도 같은 함수를 쓴다.
 *
 *   node scripts/backup-data.mjs [--to=<백업 폴더>] [--keep=30]
 *
 * 주기 실행: Windows 작업 스케줄러에 "매일 새벽 N시, 프로그램:
 * node.exe, 인수: scripts/backup-data.mjs, 시작 위치: 이 저장소 경로"로
 * 등록하면 사람이 손대지 않아도 매일 쌓인다.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

import { backupData } from "./lib/backup.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = join(root, "data");

function parseArgs(argv) {
  const flags = {};
  for (const arg of argv) {
    if (!arg.startsWith("--")) continue;
    const [key, ...rest] = arg.slice(2).split("=");
    flags[key] = rest.length > 0 ? rest.join("=") : true;
  }
  return flags;
}

const flags = parseArgs(process.argv.slice(2));
const backupRoot = flags.to ?? join(homedir(), "cgportfolio-backups");
const keep = Number(flags.keep ?? 30);

const result = backupData(dataDir, backupRoot, keep);
console.log(`data/ 를 ${result.target} 로 복사했습니다.`);
console.log(`백업 ${result.kept}개 보관 중 (--keep=${keep}, ${result.deleted}개 정리됨).`);
