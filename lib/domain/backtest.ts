import type { Snapshot, Symbol } from "./types";

/**
 * 백테스트 엔진.
 *
 * 가진 일별 종가와 환율로 실제 매매를 흉내 낸다. 수익률 공식을 쓰는 게 아니라
 * 날마다 평가하고, 정해진 날에 사고팔고, 인출하면 실제로 판다. 그래야
 * 인출이 원금을 갉아먹는 과정이나 레버리지의 복리 잠식이 결과에 드러난다.
 *
 * 한계: 여기 있는 가격 이력 구간 안에서만 돌릴 수 있다. 세금은 인출 시점에
 * 매도 차익에만 단일 세율로 매기고, 계좌별 세제 차이와 리밸런싱 과세는 반영하지 않는다.
 */

export type Allocation = { symbolId: string; weight: number };

export type BacktestConfig = {
  id: string;
  title: string;
  summary: string;
  allocations: Allocation[];
  /** 시작 시점 일시금 (원) */
  initialKrw: number;
  /** 매달 추가 납입 (원). 인출과 동시에 쓰지 않는다. */
  monthlyContributionKrw?: number;
  /** 매달 인출 (원). 자가배당 시뮬레이션용. */
  monthlyWithdrawalKrw?: number;
  rebalance?: "none" | "monthly" | "quarterly" | "yearly";
  /** 매매 수수료율 (예: 0.00015) */
  feeRate?: number;
  /** 인출 시 차감할 세율 (예: 0.22). 원금 회수분이 아닌 매도 차익에만 적용한다. */
  withdrawalTaxRate?: number;
  start?: string;
  end?: string;
};

export type BacktestResult = {
  config: BacktestConfig;
  /** 일별 평가금액. 차트와 MDD 계산에 그대로 쓴다. */
  series: Snapshot[];
  startDate: string;
  endDate: string;
  years: number;
  finalKrw: number;
  /** 넣은 돈 합계 (초기 + 추가납입) */
  investedKrw: number;
  /** 빼 쓴 돈 합계 (세후 실수령) */
  withdrawnKrw: number;
  /** 낸 세금 합계 */
  taxPaidKrw: number;
  /** 최종 평가 + 인출 누계 - 투입 = 순증 */
  netGainKrw: number;
  /** 연평균 성장률(%). cagrApplicable 이 false면 쓰지 말 것. */
  cagr: number;
  /**
   * CAGR을 써도 되는지. 초기 일시금을 넣고 중간에 넣거나 빼지 않은 경우에만 참이다.
   * 적립식이나 인출 시나리오에서 CAGR은 의미가 없으므로 화면에서 다른 지표를 써야 한다.
   */
  cagrApplicable: boolean;
  /** 넣은 돈 대비 순증률(%). 어떤 시나리오에서도 비교 가능한 값. */
  returnOnInvested: number;
  /** 자금이 소진된 날. 없으면 null */
  depletedAt: string | null;
  /** 가격 이력이 없어 제외한 종목 */
  skipped: string[];
  /**
   * 배당이 최종 성과에 더한 금액(원). 배당 반영 가격으로 돌린 결과와 주가만으로
   * 돌린 결과의 차이다 — 배당을 그대로 재투자했다고 볼 때의 기여분이다.
   * 배당 반영 가격이 없는 종목이 섞여 있으면 null이고, 그때 나머지 수치는
   * 주가만 반영한 값이라 배당을 많이 주는 종목일수록 실제보다 낮게 나온다.
   */
  dividendContributionKrw: number | null;
};

type PriceTable = Record<string, { d: string; c: number }[]>;

/** 날짜별 조회를 빠르게 하려고 Map으로 바꿔 둔다. */
function toLookup(series: { d: string; c: number }[]) {
  const map = new Map<string, number>();
  for (const point of series) map.set(point.d, point.c);
  return map;
}

function lastOnOrBefore(map: Map<string, number>, dates: string[], index: number): number | null {
  for (let i = index; i >= 0; i -= 1) {
    const value = map.get(dates[i]);
    if (value !== undefined) return value;
  }
  return null;
}

/**
 * 가격표 하나로 한 번 돌린다. 배당 기여분을 뽑으려면 같은 설정을 배당 반영
 * 가격과 주가로 각각 돌려 비교해야 하므로, 실제 계산은 이 함수에 두고
 * `runBacktest`가 두 번 부른다.
 */
function simulate(
  config: BacktestConfig,
  prices: PriceTable,
  fxHistory: { d: string; rate: number }[],
  symbols: Symbol[],
): Omit<BacktestResult, "dividendContributionKrw"> {
  const symbolById = new Map(symbols.map((s) => [s.id, s]));

  // 가격 이력이 있는 종목만 남기고, 빠진 만큼 비중을 다시 정규화한다.
  const usable = config.allocations.filter((a) => (prices[a.symbolId]?.length ?? 0) > 1);
  const skipped = config.allocations.filter((a) => !usable.includes(a)).map((a) => a.symbolId);
  const weightSum = usable.reduce((sum, a) => sum + a.weight, 0);

  const fxMap = new Map(fxHistory.map((p) => [p.d, p.rate]));

  // 모든 종목이 값을 가진 날짜만 쓴다.
  const dateSets = usable.map((a) => new Set(prices[a.symbolId].map((p) => p.d)));
  const allDates = [...new Set(usable.flatMap((a) => prices[a.symbolId].map((p) => p.d)))]
    .filter((d) => dateSets.every((set) => set.has(d)))
    .filter((d) => (!config.start || d >= config.start) && (!config.end || d <= config.end))
    .sort();

  const empty: Omit<BacktestResult, "dividendContributionKrw"> = {
    config,
    series: [],
    startDate: "",
    endDate: "",
    years: 0,
    finalKrw: 0,
    investedKrw: 0,
    withdrawnKrw: 0,
    taxPaidKrw: 0,
    netGainKrw: 0,
    cagr: 0,
    cagrApplicable: false,
    returnOnInvested: 0,
    depletedAt: null,
    skipped,
  };
  if (allDates.length < 2 || weightSum <= 0) return empty;

  const lookups = new Map(usable.map((a) => [a.symbolId, toLookup(prices[a.symbolId])]));
  const feeRate = config.feeRate ?? 0.00015;
  const taxRate = config.withdrawalTaxRate ?? 0;

  /** 심볼 통화 기준 가격을 원화로 바꾼다. */
  const priceKrwAt = (symbolId: string, index: number): number | null => {
    const raw = lastOnOrBefore(lookups.get(symbolId)!, allDates, index);
    if (raw === null) return null;
    const symbol = symbolById.get(symbolId);
    if (symbol?.currency !== "USD") return raw;
    const rate = fxMap.get(allDates[index]) ?? [...fxMap.values()][fxMap.size - 1] ?? 1;
    return raw * rate;
  };

  const shares = new Map<string, number>();
  let cashKrw = 0;
  let investedKrw = 0;
  let withdrawnKrw = 0;
  let taxPaidKrw = 0;
  let depletedAt: string | null = null;
  /** 남아있는 매입원가. 인출 시 과세 대상 차익을 가르는 데 쓴다. */
  let costBasisKrw = 0;

  /** 목표 비중대로 금액을 나눠 산다. */
  const buyByWeights = (index: number, amountKrw: number) => {
    if (amountKrw <= 0) return;
    for (const allocation of usable) {
      const unit = priceKrwAt(allocation.symbolId, index);
      if (!unit || unit <= 0) continue;
      const slice = (amountKrw * allocation.weight) / weightSum;
      const net = slice * (1 - feeRate);
      shares.set(allocation.symbolId, (shares.get(allocation.symbolId) ?? 0) + net / unit);
    }
    cashKrw -= amountKrw;
    costBasisKrw += amountKrw;
  };

  const valueAt = (index: number) => {
    let total = cashKrw;
    for (const [symbolId, qty] of shares) {
      const unit = priceKrwAt(symbolId, index);
      if (unit) total += qty * unit;
    }
    return total;
  };

  /**
   * 비중 대로 팔아 원하는 현금을 만든다. 보유분이 모자라면 전부 판다.
   * `short` 는 요청한 만큼 못 만들었다는 뜻이고, 자금 소진 판정은 이 값으로만 한다.
   * 수수료 때문에 몇 푼 모자란 것과 팔 게 없어서 못 만든 것은 다른 사건이다.
   */
  const sellForCash = (index: number, targetKrw: number): { raised: number; costOut: number; short: boolean } => {
    const total = valueAt(index) - cashKrw;
    if (total <= 0) return { raised: 0, costOut: 0, short: targetKrw > 0 };

    const ratio = Math.min(targetKrw / total, 1);
    let raised = 0;
    for (const [symbolId, qty] of shares) {
      const unit = priceKrwAt(symbolId, index);
      if (!unit) continue;
      const sellQty = qty * ratio;
      shares.set(symbolId, qty - sellQty);
      raised += sellQty * unit * (1 - feeRate);
    }

    const costOut = costBasisKrw * ratio;
    costBasisKrw -= costOut;
    return { raised, costOut, short: ratio >= 1 && total < targetKrw };
  };

  // 시작
  cashKrw = config.initialKrw;
  investedKrw += config.initialKrw;
  buyByWeights(0, config.initialKrw);

  const series: Snapshot[] = [];
  let lastMonth = allDates[0].slice(0, 7);
  let lastRebalanceMonth = lastMonth;

  for (let index = 0; index < allDates.length; index += 1) {
    const date = allDates[index];
    const month = date.slice(0, 7);
    const monthChanged = month !== lastMonth;

    if (monthChanged) {
      lastMonth = month;

      if (config.monthlyContributionKrw) {
        cashKrw += config.monthlyContributionKrw;
        investedKrw += config.monthlyContributionKrw;
        buyByWeights(index, config.monthlyContributionKrw);
      }

      if (config.monthlyWithdrawalKrw) {
        /*
         * 세금은 매도대금 전체가 아니라 차익에만 붙는다. 원금 회수분까지 과세하면
         * 인출 시나리오가 실제보다 훨씬 나쁘게 나온다. 남은 매입원가를 들고 다니면서
         * 판 비율만큼 덜어내는 방식으로 차익을 가른다.
         *
         * 목표 실수령액을 맞추려면 세금만큼 더 팔아야 하는데, 얼마를 팔지 정해야
         * 세금을 알 수 있고 세금을 알아야 얼마 팔지 정해진다. 현재 평가차익 비율로
         * 실효세율을 먼저 추정해 필요 매도액을 잡는다.
         */
        const holdingsValue = valueAt(index) - cashKrw;
        const gainRatio = holdingsValue > 0 ? Math.max((holdingsValue - costBasisKrw) / holdingsValue, 0) : 0;
        const effectiveRate = gainRatio * taxRate;
        const grossNeeded =
          effectiveRate > 0 && effectiveRate < 1
            ? config.monthlyWithdrawalKrw / (1 - effectiveRate)
            : config.monthlyWithdrawalKrw;

        const { raised, costOut, short } = sellForCash(index, grossNeeded);
        const tax = Math.max(raised - costOut, 0) * taxRate;
        const received = raised - tax;
        taxPaidKrw += tax;
        withdrawnKrw += received;
        // 인출금은 계좌 밖으로 나가므로 cashKrw 에 남기지 않는다.

        if (short && depletedAt === null) depletedAt = date;
      }

      // 리밸런싱: 전부 팔고 목표 비중대로 다시 산다.
      const shouldRebalance =
        (config.rebalance === "monthly") ||
        (config.rebalance === "quarterly" && Number(month.slice(5, 7)) % 3 === 1 && month !== lastRebalanceMonth) ||
        (config.rebalance === "yearly" && month.slice(5, 7) === "01" && month !== lastRebalanceMonth);

      if (shouldRebalance && usable.length > 1) {
        const { raised, costOut } = sellForCash(index, Number.POSITIVE_INFINITY);
        cashKrw += raised;
        buyByWeights(index, cashKrw);
        /*
         * 리밸런싱은 과세 없는 계좌 안에서 일어난다고 본다. 그래서 여기서는 세금을
         * 매기지 않고, 매입원가도 팔기 전 값을 그대로 이어받는다. 이 줄이 없으면
         * 재매수 금액이 새 원가가 되어 그동안 쌓인 평가차익이 사라지고, 나중에
         * 인출할 때 세금이 실제보다 적게 잡힌다.
         */
        costBasisKrw = costOut;
        lastRebalanceMonth = month;
      }
    }

    const value = Math.max(valueAt(index), 0);
    series.push({ at: `${date}T16:00:00+09:00`, totalKrw: Math.round(value), fxRate: fxMap.get(date) ?? 0 });
  }

  const startDate = allDates[0];
  const endDate = allDates[allDates.length - 1];
  const years = (new Date(endDate).getTime() - new Date(startDate).getTime()) / (365.25 * 24 * 3600 * 1000);
  const finalKrw = series[series.length - 1]?.totalKrw ?? 0;

  /*
   * CAGR은 "처음에 넣은 돈이 얼마로 불었나"를 연율화한 값이다. 중간에 넣거나 빼면
   * 분모가 흔들려서 숫자가 성립하지 않는다. 그런 시나리오에서는 계산하지 않고,
   * 대신 넣은 돈 대비 순증률을 쓴다.
   */
  const cagrApplicable =
    years > 0 && config.initialKrw > 0 && !config.monthlyContributionKrw && !config.monthlyWithdrawalKrw;
  const cagr = cagrApplicable ? ((finalKrw / config.initialKrw) ** (1 / years) - 1) * 100 : 0;
  const returnOnInvested = investedKrw > 0 ? ((finalKrw + withdrawnKrw - investedKrw) / investedKrw) * 100 : 0;

  return {
    config,
    series,
    startDate,
    endDate,
    years,
    finalKrw,
    investedKrw,
    withdrawnKrw,
    taxPaidKrw,
    netGainKrw: finalKrw + withdrawnKrw - investedKrw,
    cagr,
    cagrApplicable,
    returnOnInvested,
    depletedAt,
    skipped,
  };
}

/**
 * 배당까지 반영한 결과를 만든다.
 *
 * `totalReturnPrices`는 배당을 재투자했다고 보고 조정한 가격이다. 이게 있으면
 * 그쪽을 본 결과로 삼고, 주가만으로 한 번 더 돌려 차이를 배당 기여분으로 남긴다.
 * 커버드콜이나 고배당 ETF는 수익 대부분이 분배금으로 나가고 주가는 제자리라,
 * 주가만 보면 성과가 실제와 전혀 다르게 나온다.
 *
 * 한 종목이라도 조정 가격이 없으면 비교가 성립하지 않으므로 주가 기준으로
 * 돌리고 기여분은 null로 둔다 — 반쪽짜리 숫자를 그럴듯하게 보여주지 않는다.
 */
export function runBacktest(
  config: BacktestConfig,
  prices: PriceTable,
  fxHistory: { d: string; rate: number }[],
  symbols: Symbol[],
  totalReturnPrices?: PriceTable,
): BacktestResult {
  const covered =
    totalReturnPrices !== undefined &&
    config.allocations.every((allocation) => (totalReturnPrices[allocation.symbolId]?.length ?? 0) > 1);

  if (!covered) {
    return { ...simulate(config, prices, fxHistory, symbols), dividendContributionKrw: null };
  }

  const withDividends = simulate(config, totalReturnPrices!, fxHistory, symbols);
  const priceOnly = simulate(config, prices, fxHistory, symbols);
  // 인출 시나리오는 빼 쓴 돈도 성과이므로 최종 평가액만 비교하면 과소평가된다.
  const total = (result: Omit<BacktestResult, "dividendContributionKrw">) => result.finalKrw + result.withdrawnKrw;

  return { ...withDividends, dividendContributionKrw: total(withDividends) - total(priceOnly) };
}
