import { qqqLeverageOf } from "./exposure";
import type { Symbol } from "./types";

/**
 * 성격별 구성. 종목 하나하나의 비중보다 "레버리지에 얼마, 개별주에 얼마, 현금이
 * 얼마"가 주간 점검에서 먼저 볼 숫자다.
 *
 * 분류는 이미 가지고 있는 값(`kind`, 배수표)만으로 정한다 — 종목마다 성격을
 * 손으로 붙이기 시작하면 관리가 안 되고, 빠뜨린 종목이 조용히 엉뚱한 칸에 들어간다.
 */

export type ThemeKey = "leverage" | "index" | "etf" | "single" | "cash";

export const THEME_LABELS: Record<ThemeKey, string> = {
  leverage: "레버리지",
  index: "지수 ETF",
  etf: "그 밖의 ETF",
  single: "개별주",
  cash: "현금",
};

/** 표시 순서 — 위험이 큰 쪽부터. */
export const THEME_ORDER: ThemeKey[] = ["leverage", "index", "etf", "single", "cash"];

export function themeOf(symbolId: string, kind: Symbol["kind"]): ThemeKey {
  if (kind === "cash") return "cash";
  const leverage = qqqLeverageOf(symbolId);
  if (leverage > 1) return "leverage";
  if (leverage === 1) return "index";
  return kind === "etf" ? "etf" : "single";
}

export type ThemeLine = {
  theme: ThemeKey;
  label: string;
  valueKrw: number;
  weightPercent: number;
  symbolIds: string[];
};

/**
 * @param totalKrw 비중의 분모. 스냅샷의 실제 예탁자산을 넣는다 — entries 합으로
 *   나누면, 그날 종가를 몰라서 빠진 종목만큼 나머지 비중이 부풀려진다.
 */
export function summarizeComposition(
  entries: { symbolId: string; kind: Symbol["kind"]; valueKrw: number }[],
  totalKrw: number,
): ThemeLine[] {
  const byTheme = new Map<ThemeKey, { valueKrw: number; symbolIds: string[] }>();
  for (const entry of entries) {
    const theme = themeOf(entry.symbolId, entry.kind);
    const bucket = byTheme.get(theme) ?? { valueKrw: 0, symbolIds: [] };
    bucket.valueKrw += entry.valueKrw;
    bucket.symbolIds.push(entry.symbolId);
    byTheme.set(theme, bucket);
  }

  return THEME_ORDER.flatMap((theme) => {
    const bucket = byTheme.get(theme);
    if (!bucket) return [];
    return [
      {
        theme,
        label: THEME_LABELS[theme],
        valueKrw: bucket.valueKrw,
        weightPercent: totalKrw > 0 ? (bucket.valueKrw / totalKrw) * 100 : 0,
        symbolIds: bucket.symbolIds.sort(),
      },
    ];
  });
}

/**
 * 종목별 평가금액 합이 계좌 전체보다 얼마나 모자라는지. 과거 시점 재구성에서
 * 그날 종가를 모르는 종목이 빠지면 여기에 잡힌다 — 이 값이 크면 그 시점 숫자를
 * 믿으면 안 된다는 뜻이라, 리포트에 그대로 밝힌다.
 */
export function unexplainedPercent(entries: { valueKrw: number }[], totalKrw: number): number {
  if (totalKrw <= 0) return 0;
  const sum = entries.reduce((acc, entry) => acc + entry.valueKrw, 0);
  return ((totalKrw - sum) / totalKrw) * 100;
}
