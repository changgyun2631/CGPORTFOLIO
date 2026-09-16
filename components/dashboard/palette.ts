/**
 * 자산 구성·월간 배당 차트가 같이 쓰는 색상 배정. `AllocationBar`가
 * `"use client"`(자동 순환 페이지네이션 때문)인데 `MonthlyBars`는 서버
 * 컴포넌트라, 클라이언트 전용 모듈에서 이 순수 함수를 가져다 쓸 수 없다 —
 * 그래서 지시어 없는 별도 파일로 뺐다.
 */
export const palette = [
  "#4f8cff",
  "#22c9a8",
  "#f0a04b",
  "#9b7bf0",
  "#f0616d",
  "#3dc9e8",
  "#c9d14b",
  "#e87ab8",
  "#6b7ae8",
  "#54b36a",
];

/** 비중 순서대로 색을 돌려 쓴다. 종목 수가 늘어도 인접한 칸이 같은 색이 되지 않게. */
export function colorFor(index: number) {
  return palette[index % palette.length];
}
