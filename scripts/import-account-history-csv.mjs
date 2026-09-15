/**
 * 계좌수익률 CSV의 일별 예탁자산을 총 평가금액 스냅샷으로 가져온다.
 * 여러 CSV를 주면 동일 날짜의 계좌별 예탁자산을 합산한다.
 *
 * node scripts/import-account-history-csv.mjs <csv...> [--replace]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = join(root, "data");
const args = process.argv.slice(2);
const replace = args.includes("--replace");
const paths = args.filter((arg) => !arg.startsWith("--"));
if (paths.length === 0) throw new Error("계좌수익률 CSV 경로가 필요합니다.");

function parseCsvLine(line) {
  const fields = [];
  let value = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (quoted && char === '"' && line[i + 1] === '"') {
      value += '"';
      i += 1;
    } else if (char === '"') quoted = !quoted;
    else if (char === "," && !quoted) {
      fields.push(value);
      value = "";
    } else value += char;
  }
  fields.push(value);
  return fields;
}

const number = (value) => Number(String(value ?? "0").replaceAll(",", "").trim() || 0);
const totals = new Map();
for (const path of paths) {
  const decoded = new TextDecoder("euc-kr").decode(readFileSync(path));
  const rows = decoded.split(/\r?\n/).filter(Boolean).map(parseCsvLine);
  const headerIndex = rows.findIndex((row) => row.includes("일자") && row.includes("예탁자산"));
  if (headerIndex < 0) throw new Error(`${path}: 계좌수익률 헤더를 찾지 못했습니다.`);
  const dateIndex = rows[headerIndex].indexOf("일자");
  const totalIndex = rows[headerIndex].indexOf("예탁자산");
  const depositIndex = rows[headerIndex].indexOf("입금");
  const withdrawalIndex = rows[headerIndex].indexOf("출금");
  if (depositIndex < 0 || withdrawalIndex < 0) throw new Error(`${path}: 입금·출금 열을 찾지 못했습니다.`);
  for (const row of rows.slice(headerIndex + 1)) {
    const date = row[dateIndex]?.trim();
    const totalKrw = number(row[totalIndex]);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || totalKrw <= 0) continue;
    const previous = totals.get(date) ?? { totalKrw: 0, depositKrw: 0, withdrawalKrw: 0 };
    previous.totalKrw += totalKrw;
    previous.depositKrw += number(row[depositIndex]);
    previous.withdrawalKrw += number(row[withdrawalIndex]);
    totals.set(date, previous);
  }
}

const fxHistory = JSON.parse(readFileSync(join(dataDir, "fx.json"), "utf8")).sort((a, b) => a.d.localeCompare(b.d));
function fxRateAt(date) {
  let rate = fxHistory[0]?.rate ?? 1;
  for (const point of fxHistory) {
    if (point.d > date) break;
    rate = point.rate;
  }
  return rate;
}

const merged = new Map();
const principalByDate = new Map();
const historicalDates = [...totals.keys()].sort();
let runningPrincipalKrw = 0;
for (const date of historicalDates) {
  const value = totals.get(date);
  runningPrincipalKrw += value.depositKrw - value.withdrawalKrw;
  principalByDate.set(date, runningPrincipalKrw);
  merged.set(date, {
    at: `${date}T15:30:00+09:00`,
    totalKrw: value.totalKrw,
    principalKrw: runningPrincipalKrw,
    fxRate: fxRateAt(date),
  });
}
for (const snapshot of JSON.parse(readFileSync(join(dataDir, "snapshots.json"), "utf8"))) {
  merged.set(snapshot.at.slice(0, 10), snapshot);
}

// 계좌수익률 CSV가 끝난 뒤의 실제 외부 입출금만 이어 붙인다. 과거 구간은 CSV의
// 명시적인 입금·출금 열이 기준이고, 예탁자산-손익 역산값은 사용하지 않는다.
const lastHistoricalDate = historicalDates.at(-1) ?? "";
const postHistoryFlows = new Map();
for (const cashflow of JSON.parse(readFileSync(join(dataDir, "cashflows.json"), "utf8"))) {
  const date = cashflow.at.slice(0, 10);
  if ((cashflow.kind ?? "external") !== "external" || date <= lastHistoricalDate) continue;
  const amountKrw = cashflow.currency === "USD" ? cashflow.amount * fxRateAt(date) : cashflow.amount;
  const signed = cashflow.type === "deposit" ? amountKrw : -amountKrw;
  postHistoryFlows.set(date, (postHistoryFlows.get(date) ?? 0) + signed);
}

const postDates = [...postHistoryFlows.keys()].sort();
let postIndex = 0;
let carriedPrincipalKrw = 0;
const snapshots = [...merged.values()]
  .sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
  .map((snapshot) => {
    const date = snapshot.at.slice(0, 10);
    if (principalByDate.has(date)) carriedPrincipalKrw = principalByDate.get(date);
    while (postIndex < postDates.length && postDates[postIndex] <= date) {
      carriedPrincipalKrw += postHistoryFlows.get(postDates[postIndex]);
      postIndex += 1;
    }
    return { ...snapshot, principalKrw: carriedPrincipalKrw };
  });
const target = join(dataDir, replace ? "snapshots.json" : "out-snapshots.json");
writeFileSync(target, `${JSON.stringify(snapshots, null, 2)}\n`);
console.log(`${totals.size}일의 실제 계좌자산과 현금 입출금을 병합해 총 ${snapshots.length}개 스냅샷을 저장했습니다.`);
if (!replace) console.log("검토 후 --replace를 붙이면 실제 차트에 반영됩니다.");
