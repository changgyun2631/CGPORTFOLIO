import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * `data/`를 타임스탬프 폴더로 복사하고, 오래된 백업은 정리한다.
 * `backup-data.mjs`(정기 백업 cron)와 웹 가져오기 화면의 "적용 직전 자동 백업"이
 * 같이 쓴다.
 *
 * @param {string} dataDir
 * @param {string} backupRoot
 * @param {number} keep
 */
export function backupData(dataDir, backupRoot, keep = 30) {
  if (!existsSync(dataDir)) throw new Error("data/ 가 없습니다. 백업할 게 없습니다.");

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const target = join(backupRoot, stamp);
  mkdirSync(target, { recursive: true });
  cpSync(dataDir, target, { recursive: true });

  const entries = readdirSync(backupRoot)
    .filter((name) => /^\d{4}-\d{2}-\d{2}T/.test(name))
    .map((name) => ({ name, path: join(backupRoot, name) }))
    .filter((e) => statSync(e.path).isDirectory())
    .sort((a, b) => b.name.localeCompare(a.name));

  const stale = entries.slice(keep);
  for (const e of stale) rmSync(e.path, { recursive: true, force: true });

  return { target, kept: entries.length - stale.length, deleted: stale.length };
}
