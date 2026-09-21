/**
 * 증권사 "거래내역" CSV(키움 2110 화면)를 거래원장으로 바꾼다.
 *
 * 파일 IO를 하지 않는 순수 함수라 CLI 스크립트와 웹 가져오기 화면이 같이 쓴다.
 *
 * ## 이 CSV의 생김새
 *
 * **한 거래가 세 줄이다.** 헤더도 세 줄이고, 그 뒤로 세 줄씩 한 거래가 이어진다.
 * 줄마다 열 이름이 다르다 — 첫 줄은 원화 기준 금액, 둘째 줄은 종목코드와 잔고,
 * 셋째 줄은 외화 기준 금액이다. 그래서 흔한 "헤더 한 줄 + 데이터 한 줄" 파서로
 * 읽으면 통째로 어긋난다.
 *
 * ```text
 * 거래일자 거래종류 통화  거래수량 거래금액     정산금액     세금합  …
 * 종목코드 적요명   단가/환율 –     예수금잔고   외화예수금잔고 –     …
 * 거래소   종목명   –       –      거래금액(외) 정산금액(외) 수수료(외) …
 * ```
 *
 * ## 한 줄이 어디로 가는가
 *
 * | 거래종류 | 적요명 | 결과 |
 * |---|---|---|
 * | 매매 / 소수점매매 | 매수·매도 | `Transaction` (action=trade) |
 * | 입출고 | 대체입고·대체출고 | `Transaction` (action=transfer) — 현금·실현손익 없음 |
 * | 입출고 | 액면분할병합입고·출고 | 둘을 짝지어 `Transaction` 하나 (action=split) |
 * | 환전 | 외화매수·외화매도 | `CashFlow` 두 줄 (원화 한 줄, 외화 한 줄) |
 * | 입출금 | 배당금입금 | `DividendPayment` — 예수금은 배당에서 더해지므로 현금흐름으로 또 넣지 않는다 |
 * | 입출금 | 그 밖에 | `CashFlow` 한 줄 |
 *
 * 모르는 거래종류는 **조용히 버리지 않는다.** `unknown`에 모아 돌려주고, 부른
 * 쪽이 사람에게 보여준다 — 예전 원장이 이자·대여수수료 같은 줄을 말없이
 * 빠뜨려서, 나중에 예수금이 안 맞자 "원인 미상"인 보정값을 손으로 넣어야 했다.
 */
import { classifyCashFlowKind } from "./cashflow-kind.mjs";
import { parseCsvRows, parseNumber } from "./csv.mjs";

/** 헤더도 거래도 세 줄씩이다. */
const ROWS_PER_RECORD = 3;

/** 증권사 시각은 한국 시간이다. 원장의 다른 날짜들과 같은 표기를 쓴다. */
const KST = "+09:00";

function findColumn(headerRow, name) {
  return headerRow.findIndex((cell) => String(cell).trim() === name);
}

function requireColumn(headerRow, name) {
  const index = findColumn(headerRow, name);
  if (index < 0) throw new Error(`거래내역 CSV에 "${name}" 열이 없습니다.`);
  return index;
}

function cell(row, index) {
  return index >= 0 ? String(row[index] ?? "").trim() : "";
}

/** `8:09:21`처럼 시가 한 자리로 오는 값을 `08:09:21`로 맞춘다. */
function normalizeTime(value) {
  const parts = String(value ?? "").trim().split(":");
  if (parts.length !== 3 || parts.some((part) => !/^\d{1,2}$/.test(part))) return "00:00:00";
  return parts.map((part) => part.padStart(2, "0")).join(":");
}

/**
 * 세 줄짜리 헤더를 찾아 열 위치를 잡고, 거래를 하나씩 읽어 온다.
 * 열 위치를 숫자로 박아두지 않고 이름으로 찾는다 — 증권사가 열 순서를 바꿔도
 * 조용히 다른 값을 읽는 사고가 나지 않게.
 */
function readRecords(rows) {
  const headerIndex = rows.findIndex(
    (row) => row.includes("거래일자") && row.includes("거래종류") && row.includes("거래수량"),
  );
  if (headerIndex < 0) throw new Error("거래내역 CSV 헤더를 찾지 못했습니다.");
  if (rows.length < headerIndex + ROWS_PER_RECORD * 2) throw new Error("가져올 거래가 없습니다.");

  const [amountHeader, balanceHeader, foreignHeader] = rows.slice(headerIndex, headerIndex + ROWS_PER_RECORD);
  const at = {
    date: requireColumn(amountHeader, "거래일자"),
    kind: requireColumn(amountHeader, "거래종류"),
    currency: requireColumn(amountHeader, "통화"),
    shares: requireColumn(amountHeader, "거래수량"),
    grossKrw: requireColumn(amountHeader, "거래금액"),
    settledKrw: requireColumn(amountHeader, "정산금액"),
    taxKrw: findColumn(amountHeader, "세금합"),

    symbolId: requireColumn(balanceHeader, "종목코드"),
    note: requireColumn(balanceHeader, "적요명"),
    unitPrice: requireColumn(balanceHeader, "거래단가/환율"),
    cashKrw: findColumn(balanceHeader, "예수금잔고"),
    cashForeign: findColumn(balanceHeader, "외화예수금잔고"),
    time: findColumn(balanceHeader, "처리시간"),

    symbolName: findColumn(foreignHeader, "종목명"),
    grossForeign: findColumn(foreignHeader, "거래금액(외)"),
    settledForeign: findColumn(foreignHeader, "정산금액(외)"),
    feeForeign: findColumn(foreignHeader, "수수료(외)"),
  };

  const records = [];
  for (let i = headerIndex + ROWS_PER_RECORD; i + ROWS_PER_RECORD - 1 < rows.length; i += ROWS_PER_RECORD) {
    const [amountRow, balanceRow, foreignRow] = rows.slice(i, i + ROWS_PER_RECORD);
    const date = cell(amountRow, at.date);
    if (date === "") continue; // 파일 끝의 빈 줄
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new Error(`${i + 1}번째 줄에서 거래일자를 찾지 못했습니다 — 한 거래가 세 줄이라는 전제가 깨졌습니다.`);
    }

    const currency = cell(amountRow, at.currency) === "KRW" ? "KRW" : cell(amountRow, at.currency);
    const foreign = currency !== "KRW";
    records.push({
      at: `${date}T${normalizeTime(cell(balanceRow, at.time))}${KST}`,
      kind: cell(amountRow, at.kind),
      note: cell(balanceRow, at.note),
      currency,
      symbolId: cell(balanceRow, at.symbolId).replace(/^'/, ""),
      symbolName: cell(foreignRow, at.symbolName),
      shares: parseNumber(cell(amountRow, at.shares)),
      unitPrice: parseNumber(cell(balanceRow, at.unitPrice)),
      // 원화 거래는 원화 열을, 외화 거래는 외화 열을 본다. 섞어 쓰면 환율만큼 틀린다.
      gross: foreign ? parseNumber(cell(foreignRow, at.grossForeign)) : parseNumber(cell(amountRow, at.grossKrw)),
      settled: foreign ? parseNumber(cell(foreignRow, at.settledForeign)) : parseNumber(cell(amountRow, at.settledKrw)),
      grossKrw: parseNumber(cell(amountRow, at.grossKrw)),
      settledKrw: parseNumber(cell(amountRow, at.settledKrw)),
      feeForeign: parseNumber(cell(foreignRow, at.feeForeign)),
      taxKrw: parseNumber(cell(amountRow, at.taxKrw)),
      balanceAfter: foreign ? parseNumber(cell(balanceRow, at.cashForeign)) : parseNumber(cell(balanceRow, at.cashKrw)),
    });
  }

  // 세 줄씩 끊고 남는 줄이 있으면 파일이 잘렸거나 형식이 다르다는 뜻이다.
  // 조용히 버리면 마지막 거래 하나가 소리 없이 사라진다.
  const leftover = (rows.length - (headerIndex + ROWS_PER_RECORD)) % ROWS_PER_RECORD;
  if (leftover !== 0 && rows.slice(-leftover).some((row) => row.some((value) => String(value).trim() !== ""))) {
    throw new Error("마지막 거래가 세 줄을 채우지 못했습니다 — 한 거래가 세 줄이라는 전제가 깨졌거나 파일이 잘렸습니다.");
  }

  if (records.length === 0) throw new Error("가져올 거래가 없습니다.");
  return records;
}

/**
 * 매매 한 건의 수수료·세금.
 *
 * 외화는 `수수료(외)` 열을 그대로 쓴다 — 기존 원장 1,041건과 한 건도 빠짐없이
 * 같은 값이라 확인된 열이다.
 *
 * 원화 거래에는 수수료 열이 아예 없어 `세금합`만 쓴다. "정산금액 − 거래금액"으로
 * 역산하고 싶지만 **정산금액은 믿을 수 없다** — 실제 파일에서 181건이 0이었고
 * (통합증거금·미결제 처리로 보인다) 또 149건은 거래금액±수수료와 맞지 않았다.
 * 원화 매매가 들어오면 수수료가 빠졌을 수 있다고 경고한다.
 */
function tradeFee(record) {
  if (record.currency !== "KRW") return record.feeForeign;
  return record.taxKrw;
}

/** 적요명에 "출금"이 들어가면 나간 돈이다(`공모불입출금`처럼 붙어 있어도 잡힌다). */
function cashDirection(note) {
  return /출금/.test(note) ? "withdraw" : "deposit";
}

/**
 * 증권사 CSV를 원장으로 바꾼다.
 *
 * @param {string} decodedText 디코딩이 끝난 CSV 전체 텍스트
 * @param {{ accountId: string }} options
 * @returns {{
 *   transactions: object[],
 *   cashflows: object[],
 *   dividends: object[],
 *   coverage: { from: string, to: string },
 *   unknown: string[],
 *   warnings: string[],
 *   crossCheck: { ok: boolean, checked: number, mismatches: { at: string, note: string, reason: string }[] },
 * }}
 */
export function parseTransactionsCsv(decodedText, { accountId }) {
  if (!accountId) throw new Error("어느 계좌의 거래내역인지 알아야 합니다.");

  const records = readRecords(parseCsvRows(decodedText));
  const transactions = [];
  const cashflows = [];
  const dividends = [];
  const splitCandidates = new Map();
  const unknown = new Map();
  const warnings = [];

  let sequence = 0;
  const nextId = (prefix) => {
    sequence += 1;
    return `${accountId}-${prefix}-${String(sequence).padStart(4, "0")}`;
  };

  for (const record of records) {
    const { kind, note } = record;

    if (kind === "매매" || kind === "소수점매매") {
      transactions.push({
        id: nextId("tx"),
        at: record.at,
        accountId,
        symbolId: record.symbolId,
        side: /매도/.test(note) ? "sell" : "buy",
        action: "trade",
        shares: record.shares,
        price: record.unitPrice,
        fee: tradeFee(record),
      });
      continue;
    }

    if (kind === "입출고") {
      if (/액면분할|병합/.test(note)) {
        // 분할 전후 두 줄을 짝지어야 배수를 알 수 있다. 일단 모아 둔다.
        const key = `${record.symbolId}::${record.at.slice(0, 10)}`;
        const group = splitCandidates.get(key) ?? [];
        group.push(record);
        splitCandidates.set(key, group);
        continue;
      }
      // 대체입고·출고는 계좌 간 이동이다. 실제 매매가 아니라 현금도 실현손익도 움직이지 않는다.
      const incoming = /입고/.test(note);
      transactions.push({
        id: nextId("tx"),
        at: record.at,
        accountId,
        symbolId: record.symbolId,
        side: incoming ? "buy" : "sell",
        action: "transfer",
        shares: record.shares,
        price: record.unitPrice,
        fee: 0,
        note: incoming
          ? `${note} — 이체입고(계좌 간 이동·리워드 적립). 원가는 입고 시점 기준가로 추정(실제 매수 체결가 아님)`
          : `${note} — 이체출고(계좌 간 이동, 실제 시장 매도 아님)`,
      });
      continue;
    }

    if (kind === "환전") {
      // 한 줄이 원화와 외화 양쪽을 동시에 움직인다. 원장에는 두 줄로 적는다.
      const buyingForeign = /매수/.test(note);
      const rate = record.unitPrice;
      const label = `환전(${buyingForeign ? "외화매수" : "외화매도"}), 환율 ${rate.toFixed(2)}`;
      cashflows.push({
        id: nextId("cf"),
        at: record.at,
        accountId,
        type: buyingForeign ? "withdraw" : "deposit",
        amount: Math.abs(record.settledKrw),
        currency: "KRW",
        kind: "exchange",
        note: label,
      });
      cashflows.push({
        id: nextId("cf"),
        at: record.at,
        accountId,
        type: buyingForeign ? "deposit" : "withdraw",
        amount: Math.abs(record.settled),
        currency: record.currency,
        kind: "exchange",
        note: label,
      });
      continue;
    }

    if (kind === "입출금") {
      // 배당은 `dividends.json`이 맡는다. 예수금 계산이 배당을 이미 더하므로
      // 현금흐름으로 또 넣으면 두 번 세어진다.
      if (/배당금/.test(note) && record.symbolId !== "") {
        dividends.push({
          id: nextId("dv"),
          at: record.at,
          accountId,
          symbolId: record.symbolId,
          amount: record.settled,
          currency: record.currency,
        });
        continue;
      }
      cashflows.push({
        id: nextId("cf"),
        at: record.at,
        accountId,
        type: cashDirection(note),
        amount: Math.abs(record.settled),
        currency: record.currency,
        kind: classifyCashFlowKind(note),
        balanceAfter: record.balanceAfter,
        note,
      });
      continue;
    }

    unknown.set(kind, (unknown.get(kind) ?? 0) + 1);
  }

  for (const [key, group] of splitCandidates) {
    const before = group.find((record) => /출고/.test(record.note));
    const after = group.find((record) => /입고/.test(record.note));
    if (!before || !after || !(before.shares > 0)) {
      // 조회 기간이 분할 전후를 갈라놓으면 한쪽만 들어온다. 버리지 않고
      // 이동으로 남긴 뒤 사람에게 알린다 — 수량이 틀어진 채 조용히 넘어가는 게 더 나쁘다.
      for (const record of group) {
        transactions.push({
          id: nextId("tx"),
          at: record.at,
          accountId,
          symbolId: record.symbolId,
          side: /입고/.test(record.note) ? "buy" : "sell",
          action: "transfer",
          shares: record.shares,
          price: record.unitPrice,
          fee: 0,
          note: `${record.note} — 짝이 되는 분할 거래가 조회 기간에 없어 이동으로 처리했습니다`,
        });
      }
      warnings.push(`${key}: 액면분할 전후 거래가 짝을 이루지 않아 이동으로 처리했습니다.`);
      continue;
    }
    const ratio = after.shares / before.shares;
    transactions.push({
      id: `${accountId}-split-${after.symbolId}-${after.at.slice(0, 10)}`,
      at: [before.at, after.at].sort()[0],
      accountId,
      symbolId: after.symbolId,
      side: "buy",
      action: "split",
      shares: after.shares,
      price: 0,
      fee: 0,
      splitRatio: ratio,
      note: `액면분할·병합 — 수량 ${ratio}배, 현금 및 실현손익에 영향 없음`,
    });
  }

  // 같은 시각이면 매수를 먼저 놓는다. 이 CSV의 `처리시간`은 **그날 정산 배치
  // 시각**이라 하루치 거래가 전부 같은 값을 갖는다 — 체결 순서가 아니다. 그래서
  // 파일 순서대로 접으면 "판 수량이 보유수량보다 많은" 날이 생기고, 그만큼
  // 원가가 잘려 실현손익이 틀어진다(키움2 실데이터에서 5건 발생, 이 정렬로 0건).
  // 하루 안의 진짜 체결 순서는 이 파일로 알 수 없다 — 수량이 음수로 가지 않는
  // 쪽을 택한 것이다.
  const sideRank = (tx) => (tx.side === "buy" ? 0 : 1);
  transactions.sort((a, b) => a.at.localeCompare(b.at) || sideRank(a) - sideRank(b));
  cashflows.sort((a, b) => a.at.localeCompare(b.at));
  dividends.sort((a, b) => a.at.localeCompare(b.at));

  const krwTrades = records.filter((record) => /매매/.test(record.kind) && record.currency === "KRW").length;
  if (krwTrades > 0) {
    warnings.push(`원화 매매 ${krwTrades}건: 이 CSV에는 원화 수수료 열이 없어 세금합만 수수료로 넣었습니다 — 실제 수수료와 맞는지 확인이 필요합니다.`);
  }

  for (const [kind, count] of unknown) {
    warnings.push(`거래종류 "${kind}" ${count}건은 가져오기가 아직 다루지 않아 건너뛰었습니다.`);
  }

  const dates = records.map((record) => record.at).sort();
  return {
    transactions,
    cashflows,
    dividends,
    coverage: { from: dates[0], to: dates[dates.length - 1] },
    unknown: [...unknown.keys()],
    warnings,
    crossCheck: crossCheckAgainstCsv(records),
  };
}

/**
 * CSV 안에서 서로 맞아야 하는 값끼리 맞춰본다.
 *
 * 시세 API가 아니라 **파일 내부의 일관성만** 본다. 열이 한 칸 밀렸거나 인코딩이
 * 깨졌거나 "한 거래 세 줄"이 어긋나면 여기서 바로 걸린다 — 화면에서 숫자가
 * 이상하다고 느끼기 전에 잡는 게 목적이다.
 *
 * - 매매: `거래금액 ≈ 거래수량 × 거래단가`
 * - 환전: `정산금액(원) ≈ 정산금액(외) × 환율`
 *
 * 예수금잔고로 검산하려던 시도는 접었다. 이 파일의 잔고 열은 결제 시점 기준이라
 * 거래 순서대로 더해지지 않고(외화 매수가 원화 잔고를 움직이는 줄이 있다),
 * 정산금액도 181건이 0이라 기준으로 쓸 수 없었다.
 */
function crossCheckAgainstCsv(records) {
  const mismatches = [];
  let checked = 0;

  for (const record of records) {
    if (record.kind === "매매" || record.kind === "소수점매매") {
      checked += 1;
      const expected = record.shares * record.unitPrice;
      // 소수점 매매는 수량이 소수 넷째 자리까지라 반올림 오차를 넉넉히 본다.
      if (Math.abs(expected - record.gross) > Math.max(0.01, Math.abs(record.gross) * 0.0005)) {
        mismatches.push({ at: record.at, note: `${record.symbolId} ${record.note}`, reason: "거래금액이 수량×단가와 다릅니다" });
      }
      continue;
    }
    if (record.kind === "환전" && record.settled > 0) {
      checked += 1;
      const expected = record.settled * record.unitPrice;
      if (Math.abs(expected - record.settledKrw) > Math.max(1, Math.abs(record.settledKrw) * 0.002)) {
        mismatches.push({ at: record.at, note: record.note, reason: "원화 정산금액이 외화 금액×환율과 다릅니다" });
      }
    }
  }

  return { ok: mismatches.length === 0, checked, mismatches };
}
