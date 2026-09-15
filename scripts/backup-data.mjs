/**
 * data/ 백업.
 *
 * data/*.json 은 개인 금융 정보라 gitignore로 빠져 있다 — git이 지켜주지 않는다.
 * 이 스크립트는 data/ 전체를 타임스탬프 폴더로 복사해 저장소 밖(기본값:
 * 사용자 홈 아래 cgportfolio-backups)에 남긴다. 최근 N개만 남기고 오래된
 * 백업은 정리한다.
 *
 *   node scripts/backup-data.mjs [--to=<백업 폴더>] [--keep=30]
 *
 * 주기 실행: Windows 작업 스케줄러에 "매일 새벽 N시, 프로그램:
 * node.exe, 인수: scripts/backup-data.mjs, 시작 위치: 이 저장소 경로"로
 * 등록하면 사람이 손대지 않아도 매일 쌓인다.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

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

if (!existsSync(dataDir)) {
  console.error("data/ 가 없습니다. 백업할 게 없습니다.");
  process.exit(1);
}

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const target = join(backupRoot, stamp);

mkdirSync(target, { recursive: true });
cpSync(dataDir, target, { recursive: true });
console.log(`data/ 를 ${target} 로 복사했습니다.`);

// 오래된 백업 정리: 이름이 타임스탬프 형식인 폴더만 대상으로 한다.
const entries = readdirSync(backupRoot)
  .filter((name) => /^\d{4}-\d{2}-\d{2}T/.test(name))
  .map((name) => ({ name, path: join(backupRoot, name) }))
  .filter((e) => statSync(e.path).isDirectory())
  .sort((a, b) => b.name.localeCompare(a.name));

const stale = entries.slice(keep);
for (const e of stale) {
  rmSync(e.path, { recursive: true, force: true });
  console.log(`  오래된 백업 삭제: ${e.name}`);
}

console.log(`백업 ${entries.length - stale.length}개 보관 중 (--keep=${keep}).`);
