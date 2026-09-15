/**
 * 샘플 포트폴리오 생성기.
 *
 * 실제 운영에서는 이 스크립트 대신 cron이 시세를 받아 data/ 에 적재하고,
 * 거래·입출금·배당은 사용자가 입력한다. 지금은 화면이 실제처럼 돌아가는 것을
 * 확인하기 위해 결정론적 난수로 한 벌을 만들어 둔다.
 *
 *   node scripts/seed.mjs
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = join(root, "data");

/** 같은 입력이면 항상 같은 결과가 나오도록 고정 시드 난수를 쓴다. */
function mulberry32(seed) {
  return function random() {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(20260915);

/** 표준정규 근사. 박스-뮬러. */
function gauss() {
  let u = 0;
  let v = 0;
  while (u === 0) u = rand();
  while (v === 0) v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

const START = new Date("2024-01-02T00:00:00+09:00");
const END = new Date("2026-09-15T00:00:00+09:00");

function isWeekday(d) {
  const day = d.getDay();
  return day !== 0 && day !== 6;
}

function iso(d) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** 거래일 달력 */
const days = [];
for (let d = new Date(START); d <= END; d.setDate(d.getDate() + 1)) {
  if (isWeekday(d)) days.push(iso(d));
}

/**
 * 기초 지수(나스닥100 성격)의 일간 수익률을 먼저 만들고,
 * 레버리지 상품은 그 수익률의 배수로 굴린다. 그래야 QLD가 지수의 2배로,
 * TQQQ가 3배로 움직이는 관계가 데이터 안에서 실제로 성립한다.
 */
const baseReturns = days.map(() => {
  const drift = 0.00055;
  const vol = 0.0135;
  return drift + vol * gauss();
});

/** 배수형 상품: 기초 지수 일간 수익률 × 배수, 매일 리밸런싱(복리 잠식 포함) */
function leveraged(startPrice, multiple, expenseAnnual = 0.0095) {
  const daily = expenseAnnual / 252;
  let p = startPrice;
  return baseReturns.map((r) => {
    p = p * (1 + multiple * r - daily);
    return Math.max(p, 0.01);
  });
}

/** 독립적으로 움직이는 상품 */
function independent(startPrice, driftAnnual, volAnnual) {
  const drift = driftAnnual / 252;
  const vol = volAnnual / Math.sqrt(252);
  let p = startPrice;
  return days.map(() => {
    p = p * (1 + drift + vol * gauss());
    return Math.max(p, 0.01);
  });
}

/**
 * 커버드콜: 상승은 잘라내고 하락은 그대로 맞는 대신 매달 분배금을 준다.
 * 가격 자체는 거의 횡보하거나 완만히 흘러내리는 모습이 된다.
 */
function coveredCall(startPrice, multiple, capDaily) {
  let p = startPrice;
  return baseReturns.map((r) => {
    const capped = Math.min(r * multiple, capDaily);
    p = p * (1 + capped - 0.0004);
    return Math.max(p, 0.01);
  });
}

const fxSeries = (() => {
  let rate = 1318;
  return days.map(() => {
    rate = rate + 0.35 * gauss() + (1350 - rate) * 0.004;
    return Math.round(rate * 100) / 100;
  });
})();

const priceSeries = {
  QLD: leveraged(62.4, 2),
  TQQQ: leveraged(48.1, 3, 0.0086),
  SCHD: independent(26.9, 0.07, 0.14),
  418660: leveraged(21400, 2, 0.006).map((v) => Math.round(v)),
  "0015B0": leveraged(15800, 1.25, 0.008).map((v) => Math.round(v)),
  490590: coveredCall(12600, 1.0, 0.0022).map((v) => Math.round(v / 5) * 5),
  491620: coveredCall(11900, 1.0, 0.0018).map((v) => Math.round(v / 5) * 5),
};

const round2 = (v) => Math.round(v * 100) / 100;
for (const id of ["QLD", "TQQQ", "SCHD"]) {
  priceSeries[id] = priceSeries[id].map(round2);
}

/** data/prices.json : 심볼별 일별 종가 */
const prices = {};
for (const [symbolId, series] of Object.entries(priceSeries)) {
  prices[symbolId] = days.map((d, i) => ({ d, c: series[i] }));
}

/** data/fx.json */
const fx = days.map((d, i) => ({ d, rate: fxSeries[i] }));

const priceAt = (symbolId, date) => {
  const series = prices[symbolId];
  if (!series) return null;
  let last = series[0].c;
  for (const point of series) {
    if (point.d > date) break;
    last = point.c;
  }
  return last;
};

const fxAt = (date) => {
  let last = fx[0].rate;
  for (const point of fx) {
    if (point.d > date) break;
    last = point.rate;
  }
  return last;
};

/** 매달 n번째 거래일 */
function nthTradingDayOfMonth(year, month, n) {
  const prefix = `${year}-${String(month).padStart(2, "0")}`;
  const inMonth = days.filter((d) => d.startsWith(prefix));
  return inMonth[Math.min(n - 1, inMonth.length - 1)] ?? null;
}

const transactions = [];
const cashflows = [];
const dividends = [];
let seq = 0;
const nextId = (prefix) => `${prefix}-${String(++seq).padStart(4, "0")}`;

/** 계좌별 적립 규칙. 매달 같은 금액을 넣고 정해진 종목을 산다. */
const plans = [
  { accountId: "brokerage-us", symbolId: "QLD", monthlyKrw: 3_000_000, initialKrw: 120_000_000, day: 3 },
  { accountId: "brokerage-us", symbolId: "SCHD", monthlyKrw: 400_000, initialKrw: 8_000_000, day: 3 },
  { accountId: "brokerage-us", symbolId: "TQQQ", monthlyKrw: 0, initialKrw: 6_000_000, day: 3 },
  { accountId: "isa", symbolId: "418660", monthlyKrw: 1_800_000, initialKrw: 60_000_000, day: 5 },
  { accountId: "pension-saving", symbolId: "0015B0", monthlyKrw: 600_000, initialKrw: 18_000_000, day: 8 },
  { accountId: "irp", symbolId: "490590", monthlyKrw: 500_000, initialKrw: 14_000_000, day: 8 },
  { accountId: "taxfree-1", symbolId: "491620", monthlyKrw: 450_000, initialKrw: 12_000_000, day: 10 },
];

const symbols = JSON.parse(readFileSync(join(dataDir, "symbols.json"), "utf8"));
const symbolById = Object.fromEntries(symbols.map((s) => [s.id, s]));

function buy(date, accountId, symbolId, krwAmount) {
  const symbol = symbolById[symbolId];
  const unit = priceAt(symbolId, date);
  if (!unit) return;
  const rate = fxAt(date);
  // 수수료 몫을 남겨 두고 산다. 입금액을 남김없이 쓰면 예수금이 음수로 내려간다.
  const spendable = krwAmount * 0.995;
  const amountInSymbolCcy = symbol.currency === "USD" ? spendable / rate : spendable;
  const qty = Math.floor(amountInSymbolCcy / unit);
  if (qty <= 0) return;
  transactions.push({
    id: nextId("tx"),
    at: `${date}T${symbol.market === "US" ? "23:35" : "09:30"}:00+09:00`,
    accountId,
    symbolId,
    side: "buy",
    shares: qty,
    price: unit,
    fee: Math.round(qty * unit * 0.00015 * 100) / 100,
  });
}

/** 초기 매수. 산 만큼은 먼저 입금해 둬야 예수금이 음수가 되지 않는다. */
const firstDay = days[0];
for (const plan of plans) {
  if (plan.initialKrw <= 0) continue;
  cashflows.push({
    id: nextId("cf"),
    at: `${firstDay}T09:00:00+09:00`,
    accountId: plan.accountId,
    type: "deposit",
    amount: plan.initialKrw,
    currency: "KRW",
    note: "초기 납입",
  });
  buy(firstDay, plan.accountId, plan.symbolId, plan.initialKrw);
}

/** 월 적립 */
for (let y = 2024; y <= 2026; y += 1) {
  for (let m = 1; m <= 12; m += 1) {
    if (y === 2024 && m === 1) continue;
    if (y === 2026 && m > 9) continue;
    for (const plan of plans) {
      if (plan.monthlyKrw <= 0) continue;
      const date = nthTradingDayOfMonth(y, m, plan.day);
      if (!date) continue;
      cashflows.push({
        id: nextId("cf"),
        at: `${date}T09:05:00+09:00`,
        accountId: plan.accountId,
        type: "deposit",
        amount: plan.monthlyKrw,
        currency: "KRW",
      });
      buy(date, plan.accountId, plan.symbolId, plan.monthlyKrw);
    }
  }
}

/** 리밸런싱 매도 두 건 — 매도 경로도 화면에서 확인할 수 있게 넣는다. */
for (const sale of [
  { date: nthTradingDayOfMonth(2025, 6, 12), accountId: "isa", symbolId: "418660", shares: 120 },
  { date: nthTradingDayOfMonth(2026, 3, 9), accountId: "brokerage-us", symbolId: "TQQQ", shares: 45 },
]) {
  if (!sale.date) continue;
  const unit = priceAt(sale.symbolId, sale.date);
  const symbol = symbolById[sale.symbolId];
  transactions.push({
    id: nextId("tx"),
    at: `${sale.date}T${symbol.market === "US" ? "23:40" : "10:12"}:00+09:00`,
    accountId: sale.accountId,
    symbolId: sale.symbolId,
    side: "sell",
    shares: sale.shares,
    price: unit,
    fee: Math.round(sale.shares * unit * 0.00023 * 100) / 100,
    note: "리밸런싱",
  });
}

/** 출금 몇 건 */
for (const w of [
  { date: nthTradingDayOfMonth(2025, 7, 14), accountId: "isa", amount: 2_400_000 },
  { date: nthTradingDayOfMonth(2026, 3, 11), accountId: "brokerage-us", amount: 1_500_000 },
]) {
  if (!w.date) continue;
  cashflows.push({
    id: nextId("cf"),
    at: `${w.date}T16:15:00+09:00`,
    accountId: w.accountId,
    type: "withdraw",
    amount: w.amount,
    currency: "KRW",
  });
}

/**
 * 배당. 지급일 시점의 보유수량에 주당 분배금을 곱한다.
 * SCHD는 분기, 국내 커버드콜 두 종목은 월 지급으로 둔다.
 */
function sharesHeldAt(symbolId, date, accountId) {
  let total = 0;
  for (const tx of transactions) {
    if (tx.symbolId !== symbolId) continue;
    if (accountId && tx.accountId !== accountId) continue;
    if (tx.at.slice(0, 10) > date) continue;
    total += tx.side === "buy" ? tx.shares : -tx.shares;
  }
  return total;
}

const dividendPlans = [
  { symbolId: "SCHD", accountId: "brokerage-us", months: [3, 6, 9, 12], perShare: 0.27, currency: "USD" },
  { symbolId: "490590", accountId: "irp", months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], perShare: 130, currency: "KRW" },
  { symbolId: "491620", accountId: "taxfree-1", months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], perShare: 108, currency: "KRW" },
  { symbolId: "QLD", accountId: "brokerage-us", months: [3, 6, 9, 12], perShare: 0.06, currency: "USD" },
];

for (let y = 2024; y <= 2026; y += 1) {
  for (let m = 1; m <= 12; m += 1) {
    if (y === 2026 && m > 9) continue;
    for (const plan of dividendPlans) {
      if (!plan.months.includes(m)) continue;
      const date = nthTradingDayOfMonth(y, m, 15);
      if (!date) continue;
      const held = sharesHeldAt(plan.symbolId, date, plan.accountId);
      if (held <= 0) continue;
      const gross = held * plan.perShare;
      const net = plan.currency === "USD" ? Math.round(gross * 0.85 * 100) / 100 : Math.round(gross * 0.846);
      if (net <= 0) continue;
      dividends.push({
        id: nextId("dv"),
        at: `${date}T10:00:00+09:00`,
        accountId: plan.accountId,
        symbolId: plan.symbolId,
        amount: net,
        currency: plan.currency,
      });
    }
  }
}

transactions.sort((a, b) => a.at.localeCompare(b.at));
cashflows.sort((a, b) => a.at.localeCompare(b.at));
dividends.sort((a, b) => a.at.localeCompare(b.at));

/**
 * 예수금은 거래에서 파생시킨다. 입금은 늘리고 매수/출금은 줄이고 배당은 더한다.
 * 계좌 통화가 USD면 달러 예수금, KRW면 원화 예수금으로 쌓인다.
 */
const accounts = JSON.parse(readFileSync(join(dataDir, "accounts.json"), "utf8"));
const accountById = Object.fromEntries(accounts.map((a) => [a.id, a]));

function cashBalances(untilDate) {
  const balances = {};
  const add = (accountId, currency, delta) => {
    balances[accountId] ??= { KRW: 0, USD: 0 };
    balances[accountId][currency] += delta;
  };

  for (const cf of cashflows) {
    if (cf.at.slice(0, 10) > untilDate) continue;
    const account = accountById[cf.accountId];
    const signed = cf.type === "deposit" ? cf.amount : -cf.amount;
    if (account.currency === "USD") {
      add(cf.accountId, "USD", signed / fxAt(cf.at.slice(0, 10)));
    } else {
      add(cf.accountId, "KRW", signed);
    }
  }
  for (const tx of transactions) {
    const date = tx.at.slice(0, 10);
    if (date > untilDate) continue;
    const symbol = symbolById[tx.symbolId];
    const gross = tx.shares * tx.price + (tx.fee ?? 0) * (tx.side === "buy" ? 1 : -1);
    add(tx.accountId, symbol.currency, tx.side === "buy" ? -gross : gross);
  }
  for (const dv of dividends) {
    if (dv.at.slice(0, 10) > untilDate) continue;
    add(dv.accountId, dv.currency, dv.amount);
  }
  return balances;
}

/**
 * 스냅샷. 과거는 일별 종가로, 최근 이틀은 시간 단위로 촘촘히 남겨서
 * 대시보드의 "1일" 탭에도 볼 것이 있게 만든다.
 */
function totalKrwAt(date) {
  let total = 0;
  const rate = fxAt(date);
  for (const symbolId of Object.keys(priceSeries)) {
    const held = sharesHeldAt(symbolId, date);
    if (held <= 0) continue;
    const unit = priceAt(symbolId, date);
    const symbol = symbolById[symbolId];
    total += held * unit * (symbol.currency === "USD" ? rate : 1);
  }
  const balances = cashBalances(date);
  for (const bal of Object.values(balances)) {
    total += bal.KRW + bal.USD * rate;
  }
  return Math.round(total);
}

const snapshots = days.map((d) => ({ at: `${d}T16:00:00+09:00`, totalKrw: totalKrwAt(d), fxRate: fxAt(d) }));

/** 마지막 이틀은 30분 간격으로 흔들리는 값을 추가한다. */
const lastDay = days[days.length - 1];
const prevDay = days[days.length - 2];
const intraday = [];
for (const day of [prevDay, lastDay]) {
  const base = totalKrwAt(day);
  const rate = fxAt(day);
  for (let h = 9; h <= 15; h += 1) {
    for (const min of ["01", "31"]) {
      const wiggle = 1 + 0.0035 * gauss();
      intraday.push({
        at: `${day}T${String(h).padStart(2, "0")}:${min}:00+09:00`,
        totalKrw: Math.round(base * wiggle),
        fxRate: Math.round((rate + 0.4 * gauss()) * 100) / 100,
      });
    }
  }
}
const allSnapshots = [...snapshots.filter((s) => s.at.slice(0, 10) < prevDay), ...intraday].sort((a, b) =>
  a.at.localeCompare(b.at),
);

/** 최신 시세 = quotes.json. 페이지는 이 파일만 읽는다. */
const latestDate = lastDay;
const prevDate = prevDay;
const quotes = Object.keys(priceSeries).map((symbolId) => ({
  symbolId,
  price: priceAt(symbolId, latestDate),
  prevClose: priceAt(symbolId, prevDate),
  currency: symbolById[symbolId].currency,
  asOf: `${latestDate}T16:00:00+09:00`,
  marketState: symbolById[symbolId].market === "US" ? "closed" : "closed",
}));

const fxQuote = {
  pair: "USD/KRW",
  rate: fxAt(latestDate),
  prevRate: fxAt(prevDate),
  asOf: `${latestDate}T16:00:00+09:00`,
};

mkdirSync(dataDir, { recursive: true });
const write = (name, value) => {
  writeFileSync(join(dataDir, name), `${JSON.stringify(value, null, name === "prices.json" ? 0 : 2)}\n`, "utf8");
  console.log(`  ${name}`);
};

console.log(`거래일 ${days.length}일 · ${days[0]} ~ ${lastDay}`);
write("prices.json", prices);
write("fx.json", fx);
write("transactions.json", transactions);
write("cashflows.json", cashflows);
write("dividends.json", dividends);
write("snapshots.json", allSnapshots);
write("quotes.json", quotes);
write("fx-quote.json", fxQuote);

console.log(`\n거래 ${transactions.length}건 · 입출금 ${cashflows.length}건 · 배당 ${dividends.length}건 · 스냅샷 ${allSnapshots.length}개`);
console.log(`최종 평가금액 ${new Intl.NumberFormat("ko-KR").format(totalKrwAt(latestDate))}원 · 환율 ${fxQuote.rate}`);
