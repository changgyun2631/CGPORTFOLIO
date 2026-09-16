import { parseCsvRows, parseNumber } from "./csv.mjs";

/** 과거 환율 조회. 없는 날짜는 그 이전 마지막 값을 쓴다. fxHistory는 날짜(d) 오름차순이어야 한다. */
export function fxRateAt(sortedFxHistory, date) {
  let rate = sortedFxHistory[0]?.rate ?? 1;
  for (const point of sortedFxHistory) {
    if (point.d > date) break;
    rate = point.rate;
  }
  return rate;
}

/**
 * 계좌수익률 CSV 여러 개를 날짜별로 합산한다(계좌가 여러 개면 같은 날짜의
 * 예탁자산·입금·출금을 더한다).
 *
 * @param {string[]} decodedTexts - EUC-KR 디코딩이 끝난 CSV들의 전체 텍스트
 * @returns {Map<string, { totalKrw: number, depositKrw: number, withdrawalKrw: number }>}
 */
export function parseAccountHistoryTotals(decodedTexts) {
  const totals = new Map();
  for (const decoded of decodedTexts) {
    const rows = parseCsvRows(decoded);
    const headerIndex = rows.findIndex((row) => row.includes("일자") && row.includes("예탁자산"));
    if (headerIndex < 0) throw new Error("계좌수익률 CSV 헤더를 찾지 못했습니다.");
    const dateIndex = rows[headerIndex].indexOf("일자");
    const totalIndex = rows[headerIndex].indexOf("예탁자산");
    const depositIndex = rows[headerIndex].indexOf("입금");
    const withdrawalIndex = rows[headerIndex].indexOf("출금");
    if (depositIndex < 0 || withdrawalIndex < 0) throw new Error("계좌수익률 CSV에서 입금·출금 열을 찾지 못했습니다.");

    for (const row of rows.slice(headerIndex + 1)) {
      const date = row[dateIndex]?.trim();
      const totalKrw = parseNumber(row[totalIndex]);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || totalKrw <= 0) continue;
      const previous = totals.get(date) ?? { totalKrw: 0, depositKrw: 0, withdrawalKrw: 0 };
      previous.totalKrw += totalKrw;
      previous.depositKrw += parseNumber(row[depositIndex]);
      previous.withdrawalKrw += parseNumber(row[withdrawalIndex]);
      totals.set(date, previous);
    }
  }
  return totals;
}

/**
 * CSV의 날짜별 예탁자산·순입금을 기존 스냅샷·현금흐름과 합쳐 최종 스냅샷
 * 배열을 만든다. `totals`는 `parseAccountHistoryTotals`의 결과.
 *
 * @param {Map<string, { totalKrw: number, depositKrw: number, withdrawalKrw: number }>} totals
 * @param {{ fxHistory: { d: string, rate: number }[], existingSnapshots: object[], existingCashflows: object[] }} context
 */
export function buildAccountHistorySnapshots(totals, { fxHistory, existingSnapshots, existingCashflows }) {
  const sortedFxHistory = [...fxHistory].sort((a, b) => a.d.localeCompare(b.d));
  const rateAt = (date) => fxRateAt(sortedFxHistory, date);

  const merged = new Map();
  const principalByDate = new Map();
  const historicalDates = [...totals.keys()].sort();
  let runningPrincipalKrw = 0;
  for (const date of historicalDates) {
    const value = totals.get(date);
    runningPrincipalKrw += value.depositKrw - value.withdrawalKrw;
    principalByDate.set(date, runningPrincipalKrw);
    const at = `${date}T15:30:00+09:00`;
    merged.set(at, {
      at,
      totalKrw: value.totalKrw,
      principalKrw: runningPrincipalKrw,
      fxRate: rateAt(date),
    });
  }
  // 시각까지 포함해 키를 잡는다. 날짜로만 묶으면 cron이 하루에 여러 번 남긴
  // 기록이 하나로 뭉개져서, 가져오기를 돌릴 때마다 당일 세부 추이가 사라졌다.
  // 같은 CSV를 다시 넣는 경우는 at이 똑같이 만들어지므로 그대로 덮어쓴다.
  for (const snapshot of existingSnapshots) {
    merged.set(snapshot.at, snapshot);
  }

  // 계좌수익률 CSV가 끝난 뒤의 실제 외부 입출금만 이어 붙인다. 과거 구간은 CSV의
  // 명시적인 입금·출금 열이 기준이고, 예탁자산-손익 역산값은 사용하지 않는다.
  const lastHistoricalDate = historicalDates.at(-1) ?? "";
  const postHistoryFlows = new Map();
  for (const cashflow of existingCashflows) {
    const date = cashflow.at.slice(0, 10);
    if ((cashflow.kind ?? "external") !== "external" || date <= lastHistoricalDate) continue;
    const amountKrw = cashflow.currency === "USD" ? cashflow.amount * rateAt(date) : cashflow.amount;
    const signed = cashflow.type === "deposit" ? amountKrw : -amountKrw;
    postHistoryFlows.set(date, (postHistoryFlows.get(date) ?? 0) + signed);
  }

  const postDates = [...postHistoryFlows.keys()].sort();
  let postIndex = 0;
  let carriedPrincipalKrw = 0;
  return [...merged.values()]
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
}
