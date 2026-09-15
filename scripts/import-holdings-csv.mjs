/**
 * 증권사 "보유종목" CSV를 거래원장 부트스트랩으로 바꾼다.
 *
 * 이 스크립트가 만드는 건 실제 매매 이력이 아니다. CSV가 주는 건 "지금 이만큼
 * 평단가 얼마에 들고 있다"는 스냅샷뿐이라, 평단가·수량을 그대로 옮긴 매수
 * 거래 한 건으로 부트스트랩한다 (거래일은 CSV를 내보낸 날짜가 아니라 이
 * 스크립트를 돌린 날짜가 된다). 예수금은 매입금액 합계만큼 입금이 있었던
 * 것으로 맞춰 넣는다 — 실제 입출금 이력을 모를 때만 쓰는 근사치다.
 *
 * 나중에 실제 매매 이력을 따로 입력하게 되면 이 스크립트가 만든 부트스트랩
 * 거래를 지우고 진짜 거래로 바꿔야 이동평균 원가·실현손익이 정확해진다.
 *
 * 지원 형식: 위탁계좌 "보유종목현황" 내보내기 CSV, CP949(EUC-KR) 인코딩,
 * 헤더에 코드/종목명/매입가/보유량/매입금액/통화 열이 있는 형태.
 *
 *   node scripts/import-holdings-csv.mjs <csv경로> \
 *     --account-id=acc-us-main \
 *     --account-name="미국주식 위탁계좌" \
 *     --account-kind=위탁 \
 *     [--currency=USD] [--replace] [--dry-run]
 *
 * --replace 없이 돌리면 기존 data/*.json 을 덮어쓰지 않고 out-*.json 으로만
 * 미리보기를 만든다. 확인 후 --replace 로 다시 돌리면 실제 반영한다.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = join(root, "data");

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (const arg of argv) {
    if (arg.startsWith("--")) {
      const [key, ...rest] = arg.slice(2).split("=");
      flags[key] = rest.length > 0 ? rest.join("=") : true;
    } else {
      positional.push(arg);
    }
  }
  return { positional, flags };
}

const { positional, flags } = parseArgs(process.argv.slice(2));
const csvPath = positional[0];
if (!csvPath) {
  console.error("사용법: node scripts/import-holdings-csv.mjs <csv경로> [옵션]");
  process.exit(1);
}

const accountId = flags["account-id"] ?? "acc-main";
const accountName = flags["account-name"] ?? "위탁계좌";
const accountKind = flags["account-kind"] ?? "위탁";
const currency = flags["currency"] ?? "USD";
const replace = Boolean(flags["replace"]);
const dryRun = Boolean(flags["dry-run"]);

/** CP949 바이트를 EUC-KR 완성형으로 디코딩한다. node 내장 디코더가 완성형 한글을 지원하지 않아 시스템 iconv를 빌려 쓴다. */
function decodeCp949(buffer) {
  return execFileSync("iconv", ["-f", "CP949", "-t", "UTF-8"], { input: buffer }).toString("utf8");
}

function parseCsvLine(line) {
  const fields = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else cur += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ",") {
      fields.push(cur);
      cur = "";
    } else cur += ch;
  }
  fields.push(cur);
  return fields;
}

const num = (s) => Number(String(s).replace(/,/g, ""));

const raw = decodeCp949(readFileSync(csvPath));
const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
// 1행 "Version=1.0", 2행이 헤더, 3행부터 데이터.
const headerLine = lines.findIndex((l) => l.includes("종목명") && l.includes("보유량"));
if (headerLine === -1) throw new Error("헤더를 찾지 못했습니다 (지원하지 않는 CSV 형식일 수 있습니다)");
const header = parseCsvLine(lines[headerLine]);
const rows = lines.slice(headerLine + 1).map(parseCsvLine);

const holdings = rows
  .map((r) => {
    const o = {};
    header.forEach((h, i) => {
      o[h] = r[i];
    });
    return o;
  })
  .filter((o) => o["코드"])
  .map((o) => ({
    ticker: o["코드"].replace(/^'/, ""),
    name: o["종목명"],
    avgPrice: num(o["매입가"]),
    shares: num(o["보유량"]),
    costBasis: num(o["매입금액"]),
  }))
  .filter((h) => h.shares > 0);

const ETF_HINTS = /ETF|QQQ|SCHD|QLD|TQQQ/i;
const bootstrapAt = new Date().toISOString();
const totalCost = holdings.reduce((sum, h) => sum + h.costBasis, 0);

const accounts = [{ id: accountId, name: accountName, kind: accountKind, currency }];
const symbols = holdings.map((h) => ({
  id: h.ticker,
  name: h.name,
  kind: ETF_HINTS.test(h.name) || ETF_HINTS.test(h.ticker) ? "etf" : "stock",
  currency,
  market: currency === "USD" ? "US" : "KR",
}));
const transactions = holdings.map((h) => ({
  id: `boot-${h.ticker}`,
  at: bootstrapAt,
  accountId,
  symbolId: h.ticker,
  side: "buy",
  shares: h.shares,
  price: h.avgPrice,
  fee: 0,
  note: "평단가 스냅샷 부트스트랩 — 실제 매매일이 아니라 CSV 내보내기 시점 평단가·수량을 그대로 옮긴 값",
}));
const cashflows = [
  {
    id: "boot-deposit",
    at: bootstrapAt,
    accountId,
    type: "deposit",
    amount: Math.round(totalCost * 100) / 100,
    currency,
    note: "원금 미상 — 보유 종목 매입금액 합계로 근사 (실제 입출금 이력 아님)",
  },
];

console.log(`종목 ${holdings.length}개 · 매입금액 합계 ${totalCost.toFixed(2)} ${currency}`);

if (dryRun) {
  console.log(JSON.stringify({ accounts, symbols, transactions, cashflows }, null, 2));
  process.exit(0);
}

const prefix = replace ? "" : "out-";
for (const [name, value] of Object.entries({ accounts, symbols, transactions, cashflows })) {
  const target = join(dataDir, `${prefix}${name}.json`);
  if (!replace && existsSync(join(dataDir, `${name}.json`))) {
    console.log(`  data/${name}.json 이미 있음 → data/${prefix}${name}.json 으로만 미리보기 작성`);
  }
  writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`);
  console.log(`  data/${prefix}${name}.json 작성`);
}

if (!replace) {
  console.log("\n미리보기만 만들었습니다. 내용을 확인한 뒤 --replace 로 다시 돌리면 data/*.json 에 반영됩니다.");
  console.log("주의: --replace 는 기존 accounts.json/symbols.json/transactions.json/cashflows.json 을 덮어씁니다.");
}
