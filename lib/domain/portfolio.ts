import type {
  Account,
  CashFlow,
  Currency,
  DividendPayment,
  FxRate,
  PositionBasis,
  Quote,
  Symbol,
  Transaction,
} from "./types";

/**
 * 거래원장 하나에서 모든 숫자를 파생시킨다.
 *
 * 원칙: 보유수량·평균단가·실현손익은 거래에서만 나온다. 어디에도 손으로 적은
 * 잔고를 두지 않는다. 그래야 거래를 고치면 화면 전체가 일관되게 따라 움직인다.
 */

export type Position = {
  symbolId: string;
  accountId: string;
  shares: number;
  /** 심볼 통화 기준 평균 매수단가 (수수료 포함) */
  averagePrice: number;
  /** 심볼 통화 기준 남아있는 매입원가 */
  costBasis: number;
  /** 심볼 통화 기준 누적 실현손익 */
  realized: number;
  /** 증권사 현재잔고에서 가져온 예상 매도수수료율 */
  estimatedExitFeeRate?: number;
  basisAt?: string;
};

export type CashBalance = { accountId: string; currency: Currency; amount: number };

/** 평가까지 끝난 보유 한 줄. 화면은 대부분 이 타입만 본다. */
export type Holding = {
  symbolId: string;
  name: string;
  currency: Currency;
  market: Symbol["market"];
  kind: Symbol["kind"];
  shares: number;
  averagePrice: number;
  /** 심볼 통화 기준 현재가 */
  price: number;
  prevClose: number;
  /** 원화 환산 평가금액 */
  valueKrw: number;
  /** 전일 종가·전일 환율로 계산한 원화 평가금액 */
  prevValueKrw: number;
  /** 전일 대비 평가손익(원) */
  dayChangeKrw: number;
  /** 전일 대비 등락률(%) — 심볼 통화 기준 가격 변동 */
  dayChangePercent: number;
  /** 원화 환산 매입원가 */
  costKrw: number;
  /** 현재 평가금액을 전량 매도할 때 증권사가 예상하는 수수료 */
  estimatedExitFeeKrw: number;
  /** 매입 대비 누적 손익(원) */
  totalGainKrw: number;
  totalGainPercent: number;
  /** 전체에서 차지하는 비중(%) */
  weight: number;
  /** 계좌별 분해 */
  byAccount: { accountId: string; shares: number; valueKrw: number }[];
};

export type PortfolioTotals = {
  /** 총 평가금액(원) */
  totalKrw: number;
  prevTotalKrw: number;
  dayChangeKrw: number;
  dayChangePercent: number;
  /** 매입금액(원) — 현재 보유분의 원가 */
  costKrw: number;
  /** 매입 대비 손익 */
  gainKrw: number;
  gainPercent: number;
  estimatedExitFeeKrw: number;
  /** 원금(원) — 순입금액. 여기에 배당·실현손익이 쌓여 지금이 된 것이다. */
  principalKrw: number;
  principalGainKrw: number;
  principalGainPercent: number;
  /** 달러 환산 총액 */
  totalUsd: number;
  accountCount: number;
  symbolCount: number;
};

const EPSILON = 1e-9;

/** 매수/매도를 시간순으로 훑어 계좌×종목 단위 포지션을 만든다. (이동평균법) */
export function buildPositions(transactions: Transaction[]): Position[] {
  const byKey = new Map<string, Position>();
  const ordered = [...transactions].sort((a, b) => a.at.localeCompare(b.at));

  for (const tx of ordered) {
    const key = `${tx.accountId}::${tx.symbolId}`;
    const position =
      byKey.get(key) ??
      ({ symbolId: tx.symbolId, accountId: tx.accountId, shares: 0, averagePrice: 0, costBasis: 0, realized: 0 } satisfies Position);

    const fee = tx.fee ?? 0;
    const action = tx.action ?? "trade";

    if (action === "split") {
      const ratio = tx.splitRatio ?? 1;
      if (Number.isFinite(ratio) && ratio > 0 && position.shares > EPSILON) {
        position.shares *= ratio;
        position.averagePrice = position.costBasis / position.shares;
      }
      byKey.set(key, position);
      continue;
    }

    if (tx.side === "buy") {
      position.costBasis += tx.shares * tx.price + fee;
      position.shares += tx.shares;
      position.averagePrice = position.shares > EPSILON ? position.costBasis / position.shares : 0;
    } else {
      // 보유수량보다 많이 팔 수는 없다. 데이터가 어긋나면 보유분까지만 처리한다.
      const sold = Math.min(tx.shares, position.shares);
      const costOut = position.averagePrice * sold;
      if (action === "trade") position.realized += sold * tx.price - costOut - fee;
      position.shares -= sold;
      position.costBasis = Math.max(position.costBasis - costOut, 0);
      if (position.shares <= EPSILON) {
        position.shares = 0;
        position.costBasis = 0;
        position.averagePrice = 0;
      }
    }

    byKey.set(key, position);
  }

  return [...byKey.values()];
}

/** 현재 보유분은 증권사 잔고 스냅샷을 기준으로 맞춘다. 과거 원장은 실현손익 이력에만 사용한다. */
export function applyPositionBasis(positions: Position[], basis: PositionBasis[]): Position[] {
  if (basis.length === 0) return positions;

  const byKey = new Map(positions.map((position) => [`${position.accountId}::${position.symbolId}`, { ...position }]));
  const currentKeys = new Set(basis.map((line) => `${line.accountId}::${line.symbolId}`));

  for (const [key, position] of byKey) {
    if (!currentKeys.has(key)) {
      position.shares = 0;
      position.averagePrice = 0;
      position.costBasis = 0;
    }
  }

  for (const line of basis) {
    const key = `${line.accountId}::${line.symbolId}`;
    const position = byKey.get(key) ?? {
      symbolId: line.symbolId,
      accountId: line.accountId,
      shares: 0,
      averagePrice: 0,
      costBasis: 0,
      realized: 0,
    };
    position.shares = line.shares;
    position.averagePrice = line.averagePrice;
    position.costBasis = line.costBasis;
    position.estimatedExitFeeRate = line.estimatedExitFeeRate ?? 0;
    position.basisAt = line.at;
    byKey.set(key, position);
  }

  return [...byKey.values()];
}

/**
 * 예수금. 입금은 늘리고 매수·출금은 줄이고 매도대금과 배당은 더한다.
 * 계좌 통화와 다른 통화의 종목을 거래하면 그 통화 잔고가 따로 생긴다.
 */
export function buildCashBalances(
  accounts: Account[],
  symbols: Symbol[],
  transactions: Transaction[],
  cashflows: CashFlow[],
  dividends: DividendPayment[],
  fxRateAt: (date: string) => number,
): CashBalance[] {
  const symbolById = new Map(symbols.map((s) => [s.id, s]));
  const accountById = new Map(accounts.map((a) => [a.id, a]));
  const balances = new Map<string, CashBalance>();

  const add = (accountId: string, currency: Currency, delta: number) => {
    const key = `${accountId}::${currency}`;
    const current = balances.get(key) ?? { accountId, currency, amount: 0 };
    current.amount += delta;
    balances.set(key, current);
  };

  for (const cf of cashflows) {
    const account = accountById.get(cf.accountId);
    if (!account) continue;
    const signed = cf.type === "deposit" ? cf.amount : -cf.amount;
    // 입출금은 원화로 적더라도 달러계좌면 그 시점 환율로 달러 예수금이 된다.
    if (account.currency === "USD" && cf.currency === "KRW") {
      add(cf.accountId, "USD", signed / fxRateAt(cf.at.slice(0, 10)));
    } else {
      add(cf.accountId, cf.currency, signed);
    }
  }

  for (const tx of transactions) {
    if ((tx.action ?? "trade") !== "trade") continue;
    const symbol = symbolById.get(tx.symbolId);
    if (!symbol) continue;
    const fee = tx.fee ?? 0;
    const gross = tx.shares * tx.price;
    add(tx.accountId, symbol.currency, tx.side === "buy" ? -(gross + fee) : gross - fee);
  }

  for (const dv of dividends) {
    add(dv.accountId, dv.currency, dv.amount);
  }

  return [...balances.values()].filter((b) => Math.abs(b.amount) > 0.005);
}

export type BuildHoldingsInput = {
  accounts: Account[];
  symbols: Symbol[];
  transactions: Transaction[];
  cashflows: CashFlow[];
  dividends: DividendPayment[];
  positionBasis?: PositionBasis[];
  /** 실제 현금 입출금으로 계산한 현재 원금. 있으면 불완전한 거래원장 합계보다 우선한다. */
  principalKrw?: number;
  quotes: Quote[];
  fx: FxRate;
  fxRateAt: (date: string) => number;
};

export type PortfolioView = {
  holdings: Holding[];
  totals: PortfolioTotals;
  positions: Position[];
  cash: CashBalance[];
  /** 심볼 통화 기준 실현손익 합계를 원화로 환산한 값 */
  realizedKrw: number;
};

export function buildPortfolio(input: BuildHoldingsInput): PortfolioView {
  const { accounts, symbols, transactions, cashflows, dividends, positionBasis = [], quotes, fx, fxRateAt } = input;

  const symbolById = new Map(symbols.map((s) => [s.id, s]));
  const quoteById = new Map(quotes.map((q) => [q.symbolId, q]));
  const positions = applyPositionBasis(buildPositions(transactions), positionBasis);
  const cash = buildCashBalances(accounts, symbols, transactions, cashflows, dividends, fxRateAt);

  const toKrw = (amount: number, currency: Currency, rate = fx.rate) => (currency === "USD" ? amount * rate : amount);

  /** 종목별로 계좌를 합친다. */
  type Draft = Omit<Holding, "weight">;
  const drafts = new Map<string, Draft>();

  for (const position of positions) {
    if (position.shares <= EPSILON) continue;
    const symbol = symbolById.get(position.symbolId);
    if (!symbol) continue;
    const quote = quoteById.get(position.symbolId);
    const price = quote?.price ?? position.averagePrice;
    const prevClose = quote?.prevClose ?? price;

    const valueKrw = toKrw(position.shares * price, symbol.currency);
    const prevValueKrw = toKrw(position.shares * prevClose, symbol.currency, fx.prevRate);
    const costKrw = toKrw(position.costBasis, symbol.currency);
    const estimatedExitFeeKrw = valueKrw * (position.estimatedExitFeeRate ?? 0);

    const existing = drafts.get(position.symbolId);
    if (existing) {
      const totalShares = existing.shares + position.shares;
      existing.averagePrice = (existing.averagePrice * existing.shares + position.averagePrice * position.shares) / totalShares;
      existing.shares = totalShares;
      existing.valueKrw += valueKrw;
      existing.prevValueKrw += prevValueKrw;
      existing.costKrw += costKrw;
      existing.estimatedExitFeeKrw += estimatedExitFeeKrw;
      existing.byAccount.push({ accountId: position.accountId, shares: position.shares, valueKrw });
    } else {
      drafts.set(position.symbolId, {
        symbolId: symbol.id,
        name: symbol.name,
        currency: symbol.currency,
        market: symbol.market,
        kind: symbol.kind,
        shares: position.shares,
        averagePrice: position.averagePrice,
        price,
        prevClose,
        valueKrw,
        prevValueKrw,
        dayChangeKrw: 0,
        dayChangePercent: 0,
        costKrw,
        estimatedExitFeeKrw,
        totalGainKrw: 0,
        totalGainPercent: 0,
        byAccount: [{ accountId: position.accountId, shares: position.shares, valueKrw }],
      });
    }
  }

  /** 예수금도 하나의 보유 종목처럼 취급해 자산구성에 자연스럽게 섞는다. */
  for (const currency of ["USD", "KRW"] as const) {
    const symbolId = currency === "USD" ? "CASH.USD" : "CASH.KRW";
    const symbol = symbolById.get(symbolId);
    if (!symbol) continue;
    const amount = cash.filter((c) => c.currency === currency).reduce((sum, c) => sum + c.amount, 0);
    if (Math.abs(amount) < 1) continue;

    const valueKrw = toKrw(amount, currency);
    const prevValueKrw = toKrw(amount, currency, fx.prevRate);
    drafts.set(symbolId, {
      symbolId,
      name: symbol.name,
      currency,
      market: "CASH",
      kind: "cash",
      shares: amount,
      averagePrice: 1,
      price: 1,
      prevClose: 1,
      valueKrw,
      prevValueKrw,
      dayChangeKrw: 0,
      dayChangePercent: 0,
      // 예수금은 손익 개념이 없으므로 원가를 평가액과 같게 두어 손익 0으로 만든다.
      costKrw: valueKrw,
      estimatedExitFeeKrw: 0,
      totalGainKrw: 0,
      totalGainPercent: 0,
      byAccount: cash
        .filter((c) => c.currency === currency)
        .map((c) => ({ accountId: c.accountId, shares: c.amount, valueKrw: toKrw(c.amount, currency) })),
    });
  }

  const totalKrw = [...drafts.values()].reduce((sum, d) => sum + d.valueKrw, 0);
  const prevTotalKrw = [...drafts.values()].reduce((sum, d) => sum + d.prevValueKrw, 0);

  const holdings: Holding[] = [...drafts.values()]
    .map((draft) => {
      const dayChangeKrw = draft.valueKrw - draft.prevValueKrw;
      // 등락률은 환율 영향을 뺀 종목 자체의 움직임으로 본다.
      const dayChangePercent = draft.prevClose > 0 ? ((draft.price - draft.prevClose) / draft.prevClose) * 100 : 0;
      const totalGainKrw = draft.kind === "cash" ? 0 : draft.valueKrw - draft.costKrw - draft.estimatedExitFeeKrw;
      const totalGainPercent = draft.costKrw > 0 && draft.kind !== "cash" ? (totalGainKrw / draft.costKrw) * 100 : 0;
      return {
        ...draft,
        dayChangeKrw,
        dayChangePercent,
        totalGainKrw,
        totalGainPercent,
        weight: totalKrw > 0 ? (draft.valueKrw / totalKrw) * 100 : 0,
      };
    })
    .sort((a, b) => b.valueKrw - a.valueKrw);

  /** 원금 = 순입금액. 계좌 통화와 무관하게 입금 당시 원화 금액으로 본다. */
  const ledgerPrincipalKrw = cashflows.filter((cf) => (cf.kind ?? "external") === "external").reduce((sum, cf) => {
    const signed = cf.type === "deposit" ? cf.amount : -cf.amount;
    const inKrw = cf.currency === "USD" ? signed * fxRateAt(cf.at.slice(0, 10)) : signed;
    return sum + inKrw;
  }, 0);
  const principalKrw = input.principalKrw ?? ledgerPrincipalKrw;

  const realizedKrw = positions.reduce((sum, position) => {
    const symbol = symbolById.get(position.symbolId);
    if (!symbol) return sum;
    return sum + toKrw(position.realized, symbol.currency);
  }, 0);

  const costKrw = holdings.filter((h) => h.kind !== "cash").reduce((sum, h) => sum + h.costKrw, 0);
  const investedValueKrw = holdings.filter((h) => h.kind !== "cash").reduce((sum, h) => sum + h.valueKrw, 0);
  const estimatedExitFeeKrw = holdings.reduce((sum, h) => sum + h.estimatedExitFeeKrw, 0);
  const gainKrw = investedValueKrw - costKrw - estimatedExitFeeKrw;
  const dayChangeKrw = totalKrw - prevTotalKrw;

  const totals: PortfolioTotals = {
    totalKrw,
    prevTotalKrw,
    dayChangeKrw,
    dayChangePercent: prevTotalKrw > 0 ? (dayChangeKrw / prevTotalKrw) * 100 : 0,
    costKrw,
    gainKrw,
    gainPercent: costKrw > 0 ? (gainKrw / costKrw) * 100 : 0,
    estimatedExitFeeKrw,
    principalKrw,
    principalGainKrw: totalKrw - principalKrw,
    principalGainPercent: principalKrw > 0 ? ((totalKrw - principalKrw) / principalKrw) * 100 : 0,
    totalUsd: fx.rate > 0 ? totalKrw / fx.rate : 0,
    accountCount: new Set(positions.filter((p) => p.shares > EPSILON).map((p) => p.accountId)).size,
    symbolCount: holdings.length,
  };

  return { holdings, totals, positions, cash, realizedKrw };
}

/** 계좌별 평가금액 집계. 계좌 화면과 대시보드 하단 막대에서 쓴다. */
export function summarizeAccounts(accounts: Account[], holdings: Holding[]) {
  const totals = new Map<string, number>();
  for (const holding of holdings) {
    for (const line of holding.byAccount) {
      totals.set(line.accountId, (totals.get(line.accountId) ?? 0) + line.valueKrw);
    }
  }
  const grand = [...totals.values()].reduce((sum, v) => sum + v, 0);

  return accounts
    .map((account) => {
      const valueKrw = totals.get(account.id) ?? 0;
      return {
        ...account,
        valueKrw,
        weight: grand > 0 ? (valueKrw / grand) * 100 : 0,
        holdings: holdings
          .filter((h) => h.byAccount.some((line) => line.accountId === account.id))
          .map((h) => {
            const line = h.byAccount.find((l) => l.accountId === account.id)!;
            return { symbolId: h.symbolId, name: h.name, shares: line.shares, valueKrw: line.valueKrw, kind: h.kind };
          })
          .sort((a, b) => b.valueKrw - a.valueKrw),
      };
    })
    .sort((a, b) => b.valueKrw - a.valueKrw);
}

export type CashFlowLedgerEntry = CashFlow & {
  /** 이 입출금이 실제로 쌓이는 예수금 통화. 달러계좌에 원화로 입금하면 달러로 환산돼 쌓인다 (buildCashBalances와 같은 규칙). */
  bucketCurrency: Currency;
  balanceBefore: number;
  balanceAfter: number;
};

/**
 * 입출금 내역에 "이 거래 전/후 잔액"을 붙인다. `CashFlow.balanceAfter`는 표시용으로
 * 남겨둔 필드일 뿐 계산에 쓰지 않는다 — 원장(cashflows)에서 매번 다시 쌓아야
 * 값이 어긋나지 않는다 (원칙 1).
 *
 * 매수/매도·배당도 예수금을 움직이지만, 여기서는 "입출금" 자체의 전후 잔액만
 * 본다. 계좌 화면의 입출금 내역 표에 붙이는 용도라 그걸로 충분하다.
 */
export function buildCashFlowLedger(
  accounts: Account[],
  cashflows: CashFlow[],
  fxRateAt: (date: string) => number,
): CashFlowLedgerEntry[] {
  const accountById = new Map(accounts.map((a) => [a.id, a]));
  const running = new Map<string, number>();
  const ordered = [...cashflows].sort((a, b) => a.at.localeCompare(b.at));

  return ordered.flatMap((cf) => {
    const account = accountById.get(cf.accountId);
    if (!account) return [];

    const convertToUsd = account.currency === "USD" && cf.currency === "KRW";
    const bucketCurrency: Currency = convertToUsd ? "USD" : cf.currency;
    const magnitude = convertToUsd ? cf.amount / fxRateAt(cf.at.slice(0, 10)) : cf.amount;
    const signed = cf.type === "deposit" ? magnitude : -magnitude;

    const key = `${cf.accountId}::${bucketCurrency}`;
    const balanceBefore = running.get(key) ?? 0;
    const balanceAfter = balanceBefore + signed;
    running.set(key, balanceAfter);

    return [{ ...cf, bucketCurrency, balanceBefore, balanceAfter }];
  });
}
