/** 사이트 브랜드와 표시 기본값. 여기만 바꾸면 전역에 반영된다. */
export const site = {
  name: "CGPORTFOLIO",
  shortName: "CG",
  description: "보유 자산과 전일 변동을 한 화면에서 확인하는 개인 포트폴리오 대시보드",
  /** 대시보드 상단 티커 스트립과 랭킹의 기준 통화 */
  baseCurrency: "KRW" as const,
  /** 연간 예상 배당 계산에 쓰는 최근 지급 기준 개월 수 */
  dividendLookbackMonths: 12,
};

export const nav = [
  { href: "/", label: "대시보드" },
  { href: "/asset-map", label: "자산맵" },
  { href: "/accounts", label: "계좌" },
  { href: "/symbols", label: "종목" },
  { href: "/dividends", label: "배당" },
  { href: "/backtests", label: "백테스트" },
  { href: "/calendar", label: "캘린더" },
  { href: "/philosophy", label: "투자철학" },
  { href: "/reports", label: "리포트" },
] as const;
