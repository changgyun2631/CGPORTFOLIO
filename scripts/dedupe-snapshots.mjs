/**
 * 이미 저장된 `data/snapshots.json`에서 주말·휴장에 반복 찍힌 점들을 지운다.
 * 값이 완전히 같은 중복(`dedupeFlatSnapshots`)과, 값이 조금씩 달라도 같은
 * 주말(KST 토·일) 구간이면 지우는 것(`dedupeWeekendRuns`) 두 단계를 순서대로
 * 적용한다 — 후자가 필요한 이유는 `scripts/lib/dedupe-snapshots.mjs` 문서 참고
 * (총액에 환율이 곱해져 있어 주말에도 값이 미세하게 계속 바뀐다).
 * `/api/cron/refresh`는 2026-09-21부터 이런 점을 애초에 안 찍지만, 그 전에
 * 이미 쌓인 과거 데이터는 이 스크립트로 한 번 정리해야 한다.
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
import { dedupeFlatSnapshots, dedupeWeekendRuns } from "./lib/dedupe-snapshots.mjs";

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
  // 값이 완전히 같은 중복(어느 요일이든) 먼저 지우고, 남은 것 중 주말(KST
  // 토·일) 구간은 값이 조금씩 달라도 첫 점만 남긴다 — 총액에는 환율이 곱해져
  // 있어서 주말에도 미세하게 계속 바뀌므로, 값 비교만으로는 주말 중복을 다
  // 못 잡는다(dedupe-snapshots.mjs 문서 참고).
  const flatDeduped = dedupeFlatSnapshots(snapshots);
  const deduped = dedupeWeekendRuns(flatDeduped);
  const removed = snapshots.length - deduped.length;

  console.log(`스냅샷 ${snapshots.length}개 중 ${removed}개(평평한 중복 + 주말 반복)를 지웁니다. ${deduped.length}개 남습니다.`);

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
