export type Currency = "KRW" | "USD";

/** 증권계좌. 위탁/연금/ISA처럼 세제가 다른 계좌를 나눠서 본다. */
export type Account = {
  id: string;
  name: string;
  /** 위탁, 연금저축, 퇴직연금, ISA, 비과세 등 자유 문자열 */
  kind: string;
  currency: Currency;
  broker?: string;
};

export type SymbolKind = "etf" | "stock" | "cash";

/** 보유 가능한 대상. 예수금도 가격 1짜리 심볼로 다뤄 자산구성에 자연스럽게 섞는다. */
export type Symbol = {
  id: string;
  name: string;
  kind: SymbolKind;
  currency: Currency;
  /** US | KR | CASH */
  market: "US" | "KR" | "CASH";
  /** 자산맵 룩스루에서 이 심볼을 펼칠 때 쓰는 구성종목 키. 없으면 자기 자신. */
  lookthroughId?: string;
  /** 연 배당률(%) 추정치. 실지급 내역이 없을 때 예상 배당 계산에 쓴다. */
  dividendYield?: number;
};

export type TradeSide = "buy" | "sell";

export type TransactionAction = "trade" | "transfer" | "split";

export type Transaction = {
  id: string;
  /** ISO 날짜시간 */
  at: string;
  accountId: string;
  symbolId: string;
  side: TradeSide;
  /** 생략하면 일반 체결. 이체와 액면분할은 현금·실현손익에서 제외한다. */
  action?: TransactionAction;
  shares: number;
  /** 체결 단가, 심볼 통화 기준 */
  price: number;
  /** 수수료+세금, 심볼 통화 기준 */
  fee?: number;
  /** action="split"일 때 적용할 주식 수 배수. 예: 2:1 분할은 2. */
  splitRatio?: number;
  note?: string;
};

export type CashFlowKind = "external" | "exchange" | "income" | "adjustment";

export type CashFlow = {
  id: string;
  at: string;
  accountId: string;
  type: "deposit" | "withdraw";
  /** 계좌 통화 기준 금액. 양수로 적고 type으로 방향을 표현한다. */
  amount: number;
  currency: Currency;
  /** 외부 입출금만 원금에 포함한다. 환전·수익·보정은 예수금에는 반영하되 원금에서는 제외한다. */
  kind?: CashFlowKind;
  /** 이 거래 후 잔액(표시용, 계산에는 쓰지 않는다) */
  balanceAfter?: number;
  note?: string;
};

/** 증권사 현재잔고가 제공하는 보유수량·원가. 불완전한 과거 원장보다 현재 평가손익에 우선한다. */
export type PositionBasis = {
  at: string;
  accountId: string;
  symbolId: string;
  shares: number;
  averagePrice: number;
  /** 심볼 통화 기준 현재 보유분 매입금액 */
  costBasis: number;
  /** 평가금액에 곱할 증권사 예상 매도수수료율 */
  estimatedExitFeeRate?: number;
};

export type DividendPayment = {
  id: string;
  /** 지급일 */
  at: string;
  accountId: string;
  symbolId: string;
  /** 세후 실수령액, currency 기준 */
  amount: number;
  currency: Currency;
};

/** 시세 한 건. prevClose가 있어야 전일 대비를 계산할 수 있다. */
export type Quote = {
  symbolId: string;
  price: number;
  prevClose: number;
  currency: Currency;
  /** 시세 기준 시각 */
  asOf: string;
  /** 장 상태 표시용 */
  marketState?: "open" | "closed" | "pre" | "post";
};

/** 총 평가금액 시계열 한 점. 대시보드 추이 차트와 MDD의 재료. */
export type Snapshot = {
  at: string;
  /** 총 평가금액(원) */
  totalKrw: number;
  /** 그 시점의 순입금 원금. 과거 수익률을 현재 원금으로 왜곡하지 않게 한다. */
  principalKrw?: number;
  /** 그 시점 USD/KRW */
  fxRate: number;
};

/** ETF 한 종목을 펼친 구성종목. weight 합은 100에 가깝다. */
export type LookthroughLine = {
  ticker: string;
  name: string;
  /** % */
  weight: number;
  sector?: string;
};

export type LookthroughTable = Record<string, LookthroughLine[]>;

export type FxRate = {
  pair: "USD/KRW";
  rate: number;
  prevRate: number;
  asOf: string;
};

export type ReportMeta = {
  slug: string;
  title: string;
  summary: string;
  publishedAt: string;
  tags?: string[];
};

export type CalendarEvent = {
  id: string;
  date: string;
  title: string;
  /** earnings | dividend | macro | personal */
  kind: "earnings" | "dividend" | "macro" | "personal";
  symbolId?: string;
  note?: string;
};
