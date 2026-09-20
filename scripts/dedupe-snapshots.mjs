/**
 * 이미 저장된 `data/snapshots.json`에서 주말·휴장에 값이 안 바뀐 채 반복
 * 찍힌 점들을 지운다(각 평평한 구간의 첫 점만 남김). `/api/cron/refresh`는
 * 2026-09-21부터 이런 점을 애초에 안 찍지만, 그 전에 이미 쌓인 과거 데이터는
 * 이 스크립트로 한 번 정리해야 한다.
 *
 * 기본은 검토용 `data/out-snapshots.json`만 쓴다. `--replace`를 붙여야 실제
 * `data/snapshots.json`을 교체한다(적용 직전 자동 백업).
 *
 *   node scripts/dedupe-snapshots.mjs [--replace]
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { withDataLock, writeJsonAtomic } from "./lib/atomic-write.mjs";
import { backupData } from "./lib/backup.mjs";
import { dedupeFlatSnapshots } from "./lib/dedupe-snapshots.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = join(root, "data");
const backupRoot = join(homedir(), "cgportfolio-backups");

function parseArgs(argv) {
  const flags = {};
  for (const arg of argv) {
    if (!arg.startsWith("--")) continue;
    const [key, ...rest] = arg.slice(2).split("=");
    flags[key] = rest.length > 0 ? rest.join("=") : true;
  }
  return flags;
}

function main() {
  const flags = parseArgs(process.argv.slice(2));

  const snapshots = JSON.parse(readFileSync(join(dataDir, "snapshots.json"), "utf8"));
  const deduped = dedupeFlatSnapshots(snapshots);
  const removed = snapshots.length - deduped.length;

  console.log(`스냅샷 ${snapshots.length}개 중 ${removed}개(평평한 구간의 중복)를 지웁니다. ${deduped.length}개 남습니다.`);

  const target = join(dataDir, flags.replace ? "snapshots.json" : "out-snapshots.json");
  const write = () => writeJsonAtomic(target, `${JSON.stringify(deduped, null, 2)}\n`);

  if (flags.replace) {
    backupData(dataDir, backupRoot);
    withDataLock(dataDir, write);
  } else {
    write();
  }

  console.log(`${target}에 저장했습니다.`);
  if (!flags.replace) console.log("검토 후 --replace를 붙이면 실제 data/snapshots.json으로 반영됩니다.");
}

main();
