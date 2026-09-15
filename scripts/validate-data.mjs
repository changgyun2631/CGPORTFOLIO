/**
 * data/*.json 전체의 참조 무결성·형식·정렬을 검사한다. 개인 금액 자체는 출력하지
 * 않고 위반 종류와 식별자(계좌/종목 id, 날짜)만 보여준다.
 *
 *   node scripts/validate-data.mjs
 *
 * 세 가져오기 스크립트(`import-position-basis-csv.mjs`, `import-account-history-csv.mjs`,
 * `normalize-ledger.mjs`)도 `--replace` 직전에 같은 검증기(`scripts/lib/validate.mjs`)를
 * 내부적으로 써서, 검증에 실패하면 기존 data/*.json을 바꾸지 않고 중단한다.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { validateAll } from "./lib/validate.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = join(root, "data");

function readJson(name, fallback) {
  try {
    return JSON.parse(readFileSync(join(dataDir, name), "utf8"));
  } catch (error) {
    if (fallback !== undefined && error.code === "ENOENT") return fallback;
    const hint = error.code === "ENOENT" ? " 개인 데이터는 저장소에 없습니다. `node scripts/seed.mjs` 를 먼저 실행하세요." : "";
    throw new Error(`data/${name} 을 읽지 못했습니다.${hint} (${error.message})`);
  }
}

const data = {
  accounts: readJson("accounts.json"),
  symbols: readJson("symbols.json"),
  transactions: readJson("transactions.json"),
  cashflows: readJson("cashflows.json"),
  dividends: readJson("dividends.json"),
  positionBasis: readJson("position-basis.json", []),
  snapshots: readJson("snapshots.json"),
};

const errors = validateAll(data);
if (errors.length > 0) {
  console.error(`검증 실패: ${errors.length}건`);
  for (const error of errors) console.error(`  - ${error}`);
  process.exitCode = 1;
} else {
  console.log("검증 통과: 참조 무결성·형식·정렬 이상 없음");
}
