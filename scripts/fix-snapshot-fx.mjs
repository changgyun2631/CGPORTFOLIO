/**
 * 이미 저장된 `data/snapshots.json`의 `fxRate`만 실제 과거 환율(`data/fx.json`)로
 * 다시 채운다. 계좌수익률 CSV로 과거 스냅샷을 만들 때 `fxRate`를 날짜별로
 * `fx.json`에서 가져왔는데, 그게 가짜 데이터였던 동안 만들어진 스냅샷이 잘못된
 * 환율을 물고 있다 — `totalKrw`·`principalKrw`는 CSV의 예탁자산을 그대로 쓴
 * 값이라 원래도 정확했으므로 건드리지 않는다.
 *
 * 반드시 `scripts/fetch-fx-history.mjs --replace`를 먼저 실행해 `data/fx.json`이
 * 실제 값인 뒤에 돌릴 것.
 *
 * 기본은 검토용 `data/out-snapshots.json`만 쓴다. `--replace`를 붙여야 실제
 * `data/snapshots.json`을 교체한다(적용 직전 자동 백업).
 *
 *   node scripts/fix-snapshot-fx.mjs [--replace]
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { withDataLock, writeJsonAtomic } from "./lib/atomic-write.mjs";
import { backupData } from "./lib/backup.mjs";
import { fixSnapshotFxRates } from "./lib/fix-snapshot-fx.mjs";

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
  const fxHistory = JSON.parse(readFileSync(join(dataDir, "fx.json"), "utf8"));

  const fixed = fixSnapshotFxRates(snapshots, fxHistory);
  const changed = fixed.filter((s, i) => s.fxRate !== snapshots[i].fxRate).length;

  console.log(`스냅샷 ${snapshots.length}개 중 ${changed}개의 fxRate가 바뀝니다.`);

  const target = join(dataDir, flags.replace ? "snapshots.json" : "out-snapshots.json");
  const write = () => writeJsonAtomic(target, `${JSON.stringify(fixed, null, 2)}\n`);

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
