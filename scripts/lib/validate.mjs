/**
 * data/*.json 무결성 검증기. 순수 함수만 모아 뒀다 — `validate-data.mjs`(전체
 * 상태 점검)와 세 가져오기 스크립트(`--replace` 직전 가드) 양쪽에서 재사용한다.
 * 개인 금액 자체는 에러 메시지에 절대 넣지 않는다 — 위반 종류와 식별자만 알려준다.
 */

const isFiniteNumber = (value) => typeof value === "number" && Number.isFinite(value);
const isValidDate = (value) => typeof value === "string" && !Number.isNaN(Date.parse(value));

function findDuplicates(items, keyFn) {
  const seen = new Set();
  const duplicates = new Set();
  for (const item of items) {
    const key = keyFn(item);
    if (seen.has(key)) duplicates.add(key);
    seen.add(key);
  }
  return duplicates;
}

export function validateAccounts(accounts) {
  const errors = [];
  const validCurrencies = new Set(["KRW", "USD"]);
  for (const dup of findDuplicates(accounts, (a) => a.id)) errors.push(`accounts: 중복된 id "${dup}"`);
  accounts.forEach((account, index) => {
    const label = account.id ?? `#${index}`;
    if (!account.id) errors.push(`accounts[${label}]: id 누락`);
    if (!validCurrencies.has(account.currency)) errors.push(`accounts[${label}]: currency 값이 올바르지 않음`);
  });
  return errors;
}

export function validateSymbols(symbols) {
  const errors = [];
  const validKinds = new Set(["etf", "stock", "cash"]);
  const validMarkets = new Set(["US", "KR", "CASH"]);
  const validCurrencies = new Set(["KRW", "USD"]);
  for (const dup of findDuplicates(symbols, (s) => s.id)) errors.push(`symbols: 중복된 id "${dup}"`);
  symbols.forEach((symbol, index) => {
    const label = symbol.id ?? `#${index}`;
    if (!symbol.id) errors.push(`symbols[${label}]: id 누락`);
    if (!validKinds.has(symbol.kind)) errors.push(`symbols[${label}]: kind 값이 올바르지 않음`);
    if (!validMarkets.has(symbol.market)) errors.push(`symbols[${label}]: market 값이 올바르지 않음`);
    if (!validCurrencies.has(symbol.currency)) errors.push(`symbols[${label}]: currency 값이 올바르지 않음`);
  });
  return errors;
}

export function validateTransactions(transactions, { accountIds, symbolIds }) {
  const errors = [];
  for (const dup of findDuplicates(transactions, (t) => t.id)) errors.push(`transactions: 중복된 id "${dup}"`);
  transactions.forEach((tx, index) => {
    const label = tx.id ?? `#${index}`;
    if (!isValidDate(tx.at)) errors.push(`transactions[${label}]: at 날짜가 올바르지 않음`);
    if (!accountIds.has(tx.accountId)) errors.push(`transactions[${label}]: 존재하지 않는 accountId (${tx.accountId})`);
    if (!symbolIds.has(tx.symbolId)) errors.push(`transactions[${label}]: 존재하지 않는 symbolId (${tx.symbolId})`);
    if (tx.side !== "buy" && tx.side !== "sell") errors.push(`transactions[${label}]: side 값이 올바르지 않음`);
    if (tx.action !== undefined && !["trade", "transfer", "split"].includes(tx.action)) {
      errors.push(`transactions[${label}]: action 값이 올바르지 않음`);
    }
    if (!isFiniteNumber(tx.shares) || tx.shares <= 0) errors.push(`transactions[${label}]: shares가 유효한 양수가 아님`);
    if (!isFiniteNumber(tx.price) || tx.price < 0) errors.push(`transactions[${label}]: price가 유효하지 않음`);
    if (tx.fee !== undefined && (!isFiniteNumber(tx.fee) || tx.fee < 0)) errors.push(`transactions[${label}]: fee가 유효하지 않음`);
    if (tx.action === "split" && (!isFiniteNumber(tx.splitRatio) || tx.splitRatio <= 0 || tx.splitRatio === 1)) {
      errors.push(`transactions[${label}]: splitRatio가 유효하지 않음 (분할배수는 0보다 크고 1이 아니어야 함)`);
    }
  });
  return errors;
}

export function validateCashFlows(cashflows, { accountIds }) {
  const errors = [];
  const validCurrencies = new Set(["KRW", "USD"]);
  const validKinds = new Set(["external", "exchange", "income", "adjustment"]);
  for (const dup of findDuplicates(cashflows, (c) => c.id)) errors.push(`cashflows: 중복된 id "${dup}"`);
  cashflows.forEach((flow, index) => {
    const label = flow.id ?? `#${index}`;
    if (!isValidDate(flow.at)) errors.push(`cashflows[${label}]: at 날짜가 올바르지 않음`);
    if (!accountIds.has(flow.accountId)) errors.push(`cashflows[${label}]: 존재하지 않는 accountId (${flow.accountId})`);
    if (flow.type !== "deposit" && flow.type !== "withdraw") errors.push(`cashflows[${label}]: type 값이 올바르지 않음`);
    if (!isFiniteNumber(flow.amount) || flow.amount < 0) errors.push(`cashflows[${label}]: amount가 유효하지 않음`);
    if (!validCurrencies.has(flow.currency)) errors.push(`cashflows[${label}]: currency 값이 올바르지 않음`);
    if (flow.kind !== undefined && !validKinds.has(flow.kind)) errors.push(`cashflows[${label}]: kind 값이 올바르지 않음`);
  });
  return errors;
}

export function validateDividends(dividends, { accountIds, symbolIds }) {
  const errors = [];
  const validCurrencies = new Set(["KRW", "USD"]);
  for (const dup of findDuplicates(dividends, (d) => d.id)) errors.push(`dividends: 중복된 id "${dup}"`);
  dividends.forEach((div, index) => {
    const label = div.id ?? `#${index}`;
    if (!isValidDate(div.at)) errors.push(`dividends[${label}]: at 날짜가 올바르지 않음`);
    if (!accountIds.has(div.accountId)) errors.push(`dividends[${label}]: 존재하지 않는 accountId (${div.accountId})`);
    if (!symbolIds.has(div.symbolId)) errors.push(`dividends[${label}]: 존재하지 않는 symbolId (${div.symbolId})`);
    if (!isFiniteNumber(div.amount) || div.amount < 0) errors.push(`dividends[${label}]: amount가 유효하지 않음`);
    if (!validCurrencies.has(div.currency)) errors.push(`dividends[${label}]: currency 값이 올바르지 않음`);
  });
  return errors;
}

export function validatePositionBasis(positionBasis, { accountIds, symbolIds }) {
  const errors = [];
  for (const dup of findDuplicates(positionBasis, (p) => `${p.accountId}::${p.symbolId}`)) {
    errors.push(`position-basis: 계좌·종목 조합 중복 (${dup})`);
  }
  positionBasis.forEach((entry, index) => {
    const label = entry.accountId && entry.symbolId ? `${entry.accountId}::${entry.symbolId}` : `#${index}`;
    if (!isValidDate(entry.at)) errors.push(`position-basis[${label}]: at 날짜가 올바르지 않음`);
    if (!accountIds.has(entry.accountId)) errors.push(`position-basis[${label}]: 존재하지 않는 accountId (${entry.accountId})`);
    if (!symbolIds.has(entry.symbolId)) errors.push(`position-basis[${label}]: 존재하지 않는 symbolId (${entry.symbolId})`);
    if (!isFiniteNumber(entry.shares) || entry.shares < 0) errors.push(`position-basis[${label}]: shares가 유효하지 않음`);
    if (!isFiniteNumber(entry.averagePrice) || entry.averagePrice < 0) {
      errors.push(`position-basis[${label}]: averagePrice가 유효하지 않음`);
    }
    if (!isFiniteNumber(entry.costBasis) || entry.costBasis < 0) errors.push(`position-basis[${label}]: costBasis가 유효하지 않음`);
    if (
      entry.estimatedExitFeeRate !== undefined &&
      (!isFiniteNumber(entry.estimatedExitFeeRate) || entry.estimatedExitFeeRate < 0 || entry.estimatedExitFeeRate > 1)
    ) {
      errors.push(`position-basis[${label}]: estimatedExitFeeRate가 0~1 범위를 벗어남`);
    }
  });
  return errors;
}

export function validateSnapshots(snapshots) {
  const errors = [];
  const seenDates = new Set();
  let previousTime = -Infinity;
  snapshots.forEach((snap, index) => {
    const label = snap.at ?? `#${index}`;
    if (!isValidDate(snap.at)) {
      errors.push(`snapshots[${label}]: at 날짜가 올바르지 않음`);
      return;
    }
    const time = Date.parse(snap.at);
    const dateKey = snap.at.slice(0, 10);
    if (seenDates.has(dateKey)) errors.push(`snapshots[${label}]: 날짜 중복 (${dateKey})`);
    seenDates.add(dateKey);
    if (time < previousTime) errors.push(`snapshots[${label}]: 정렬이 어긋남 (이전 시점보다 과거)`);
    previousTime = Math.max(previousTime, time);
    if (!isFiniteNumber(snap.totalKrw) || snap.totalKrw < 0) errors.push(`snapshots[${label}]: totalKrw가 유효하지 않음`);
    if (!isFiniteNumber(snap.fxRate) || snap.fxRate <= 0) errors.push(`snapshots[${label}]: fxRate가 유효하지 않음`);
    if (snap.principalKrw !== undefined && (!isFiniteNumber(snap.principalKrw) || snap.principalKrw < 0)) {
      errors.push(`snapshots[${label}]: principalKrw가 유효하지 않음`);
    }
  });
  return errors;
}

/**
 * position-basis.json의 기준일이 이미 반영된 거래·입출금보다 과거로 되돌아가면
 * 오래된 CSV를 실수로 최신 기준값에 덮어썼을 가능성이 크다 ("최신 기준일 역행").
 */
export function validateBasisNotRegressing(positionBasis, { transactions, cashflows }) {
  const errors = [];
  if (positionBasis.length === 0) return errors;
  const basisTimes = positionBasis.map((entry) => Date.parse(entry.at)).filter((t) => !Number.isNaN(t));
  if (basisTimes.length === 0) return errors;
  const latestBasisTime = Math.max(...basisTimes);
  const ledgerTimes = [
    ...transactions.map((tx) => Date.parse(tx.at)),
    ...cashflows.map((flow) => Date.parse(flow.at)),
  ].filter((t) => !Number.isNaN(t));
  if (ledgerTimes.length === 0) return errors;
  const latestLedgerTime = Math.max(...ledgerTimes);
  if (latestBasisTime < latestLedgerTime) {
    errors.push("position-basis: 기준일이 원장의 최신 거래·입출금보다 과거임 (최신 기준일 역행 의심)");
  }
  return errors;
}

export function validateAll({ accounts, symbols, transactions, cashflows, dividends, positionBasis, snapshots }) {
  const accountIds = new Set(accounts.map((a) => a.id));
  const symbolIds = new Set(symbols.map((s) => s.id));
  return [
    ...validateAccounts(accounts),
    ...validateSymbols(symbols),
    ...validateTransactions(transactions, { accountIds, symbolIds }),
    ...validateCashFlows(cashflows, { accountIds }),
    ...validateDividends(dividends, { accountIds, symbolIds }),
    ...validatePositionBasis(positionBasis, { accountIds, symbolIds }),
    ...validateSnapshots(snapshots),
    ...validateBasisNotRegressing(positionBasis, { transactions, cashflows }),
  ];
}
