/**
 * 마지막 스냅샷 이후 빈 날짜를 그날 종가로 메운다.
 *
 *   node scripts/backfill-snapshots.mjs [--replace] [--until=2026-09-18]
 *
 * 실제 계산은 `scripts/lib/backfill-snapshots.mjs`(순수 함수)에 있다.
 * 붙이지 않으면 `data/out-snapshots.json`에 미리보기만 쓴다.
 *
 * **마지막 스냅샷 이후로 매매·입출금·배당이 있으면 거부한다** — 보유수량을
 * 증권사 현재 잔고에서 가져오므로, 그 사이 거래가 있었다면 과거 날짜에 지금
 * 수량을 적용하게 되어 틀린 금액이 남는다.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { withDataLock, writeJsonAtomic } from "./lib/atomic-write.mjs";
import { backfillSnapshots } from "./lib/backfill-snapshots.mjs";
import { validateSnapshots } from "./lib/validate.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = join(root, "data");
const readJson = (name) => JSON.parse(readFileSync(join(dataDir, name), "utf8"));

const flags = Object.fromEntries(
  process.argv
    .slice(2)
    .filter((arg) => arg.startsWith("--"))
    .map((arg) => {
      const [key, ...rest] = arg.slice(2).split("=");
      return [key, rest.length ? rest.join("=") : true];
    }),
);

const snapshots = readJson("snapshots.json");
const positionBasis = readJson("position-basis.json");
const symbols = readJson("symbols.json");
const transactions = readJson("transactions.json");
const cashflows = readJson("cashflows.json");
const dividends = readJson("dividends.json");

const lastAt = [...snapshots].sort((a, b) => a.at.localeCompare(b.at)).at(-1)?.at;
if (!lastAt) throw new Error("기준이 될 스냅샷이 하나도 없습니다.");

// 비교는 **시각이 아니라 날짜**로 한다. 채우는 날은 마지막 스냅샷 **다음 날부터**라,
// 같은 날 늦게 찍힌 기록(예: 15:30 스냅샷 뒤 16:32 환전정산입금)은 이미 그 다음 날
// 수량에 반영돼 있어 문제가 없다. 시각으로 비교하면 이런 줄에 걸려 매번 거부된다.
const lastDate = lastAt.slice(0, 10);
const changedSince = [...transactions, ...cashflows, ...dividends].filter((row) => row.at.slice(0, 10) > lastDate);
if (changedSince.length > 0) {
  console.error(
    `마지막 스냅샷(${lastDate}) 다음 날부터 장부 기록이 ${changedSince.length}건 있습니다 — ` +
      "그 사이 보유수량이 달라졌을 수 있어 과거 날짜를 채우지 않습니다.",
  );
  process.exit(1);
}

// 장부가 채우려는 날짜보다 먼저 끝나 있으면, 그 사이 매매가 있었는지 **알 수 없다**.
// 없다고 단정하지 않는다 — 조회 기간이 거기까지였을 뿐일 수 있다(거래내역 CSV는
// 내려받은 날까지만 담긴다). 보유수량은 증권사 현재 잔고를 쓰므로, 그 사이 산 만큼
// 과거 날짜가 부풀려진다. 막지는 않되 반드시 알린다.
const lastLedgerAt = [...transactions, ...cashflows, ...dividends]
  .map((row) => row.at)
  .sort()
  .at(-1);
if (lastLedgerAt && lastLedgerAt.slice(0, 10) <= lastDate) {
  console.warn(
    `경고: 원장이 ${lastLedgerAt.slice(0, 10)}에서 끝납니다 — 그 뒤 매매가 있었다면 ` +
      "채운 날짜의 보유수량이 실제보다 많습니다. 거래내역 CSV를 최신으로 다시 받으면 정확해집니다.",
  );
}

const currencyById = new Map(symbols.map((symbol) => [symbol.id, symbol.currency]));
const holdings = positionBasis.map((line) => ({
  symbolId: line.symbolId,
  shares: line.shares,
  currency: currencyById.get(line.symbolId) ?? "USD",
}));

/** 예수금은 원장에서 다시 쌓는다 — `buildCashBalances`와 같은 규칙이다. */
const cash = { KRW: 0, USD: 0 };
for (const flow of cashflows) cash[flow.currency] += (flow.type === "deposit" ? 1 : -1) * flow.amount;
for (const tx of transactions) {
  if ((tx.action ?? "trade") !== "trade") continue;
  const gross = tx.shares * tx.price;
  const fee = tx.fee ?? 0;
  const currency = currencyById.get(tx.symbolId) ?? "USD";
  cash[currency] += tx.side === "buy" ? -(gross + fee) : gross - fee;
}
for (const dividend of dividends) cash[dividend.currency] += dividend.amount;

const { added, skipped } = backfillSnapshots({
  snapshots,
  holdings,
  cash,
  prices: readJson("prices.json"),
  fxHistory: readJson("fx.json"),
  until: typeof flags.until === "string" ? flags.until : undefined,
});

for (const { date, reason } of skipped) console.warn(`${date}: 건너뜀 — ${reason}`);
if (added.length === 0) {
  console.log("채울 날짜가 없습니다.");
  process.exit(0);
}

const next = [...snapshots, ...added].sort((a, b) => a.at.localeCompare(b.at));
const errors = validateSnapshots(next);
if (errors.length > 0) {
  console.error("검증 실패 — 반영을 중단합니다:");
  for (const error of errors.slice(0, 10)) console.error(`  - ${error}`);
  process.exit(1);
}

const target = join(dataDir, flags.replace ? "snapshots.json" : "out-snapshots.json");
const write = () => writeJsonAtomic(target, `${JSON.stringify(next, null, 2)}\n`);
if (flags.replace) withDataLock(dataDir, write);
else write();

console.log(
  `${added.map((snapshot) => snapshot.at.slice(0, 10)).join(", ")} ${added.length}일을 채워 ` +
    `총 ${next.length}개 스냅샷을 ${flags.replace ? "반영했습니다" : "미리보기에 저장했습니다"}.`,
);
if (!flags.replace) console.log("검토 후 --replace를 붙이면 실제 차트에 반영됩니다.");
