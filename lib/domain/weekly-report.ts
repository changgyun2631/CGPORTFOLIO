import type { ThemeLine } from "./composition";
import type { ExposureSummary } from "./exposure";
import type { ReportMeta } from "./types";

/**
 * 주간 노출·구성 리포트를 만든다. 매주 예약 실행이 이 함수로 그 주의 기록을 남긴다 —
 * 대시보드는 항상 "지금"만 보여주므로, 시간이 지난 뒤 "그때 어땠더라"를 되짚으려면
 * 그 시점 값을 얼려 둔 글이 따로 있어야 한다.
 *
 * 여기서 만드는 건 **관찰 기록**이다. 시황 해석이나 매매 권고는 넣지 않는다 —
 * 외부 시장 정보를 읽어오지도 않고, 무엇을 사고팔지는 자동 생성이 판단할 일이
 * 아니다. 판단은 `data/philosophy.md`의 원칙을 보고 사람이 한다.
 *
 * 순수 함수다. 시각·수치는 전부 인자로 받고, 파일 쓰기는 호출하는 쪽이 한다.
 */

export type GeneratedReport = ReportMeta & { body: string };

export type PointInTime = {
  label: string;
  at: string;
  totalKrw: number;
  exposure: ExposureSummary;
  themes: ThemeLine[];
  /** 종목별 평가금액 합으로 설명되지 않은 비율(%) — 과거 재구성의 신뢰도 */
  unexplainedPercent: number;
};

export type HoldingLine = {
  symbolId: string;
  name: string;
  shares: number;
  valueKrw: number;
  weightPercent: number;
  /** 매입원가 대비 누적 수익률(%) */
  totalGainPercent: number;
  totalGainKrw: number;
};

export type SeriesFacts = {
  /** 구간 최고점 대비 현재 비율(%) */
  vsPeakPercent: number;
  maxDrawdown: number;
  peakAt: string | null;
  principalKrw: number;
  principalGainPercent: number;
};

export type WeeklyReportInput = {
  at: string;
  current: PointInTime;
  past: PointInTime[];
  holdings: HoldingLine[];
  facts: SeriesFacts;
};

/** 그 주의 월요일(로컬 날짜). 같은 주에 두 번 돌려도 같은 슬러그가 나온다. */
export function weekStartOf(at: string): string {
  const d = new Date(at);
  const day = (d.getDay() + 6) % 7; // 월요일=0
  d.setDate(d.getDate() - day);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const pct = (value: number, digits = 1) => `${value.toFixed(digits)}%`;
/** 수익률처럼 "비율 자체"인 값. */
const signedPct = (value: number, digits = 1) => `${value > 0 ? "+" : ""}${value.toFixed(digits)}%`;
/** 비중 차이처럼 "퍼센트끼리의 차"인 값은 %p로 적는다. */
const signedPp = (value: number, digits = 1) => `${value > 0 ? "+" : ""}${value.toFixed(digits)}%p`;
const won = (value: number) => `${Math.round(value).toLocaleString("ko-KR")}원`;
const signedWon = (value: number) => `${value > 0 ? "+" : ""}${Math.round(value).toLocaleString("ko-KR")}원`;

function themeWeight(point: PointInTime, theme: string): number | null {
  return point.themes.find((line) => line.theme === theme)?.weightPercent ?? null;
}

export function buildWeeklyExposureReport({ at, current, past, holdings, facts }: WeeklyReportInput): GeneratedReport {
  const weekStart = weekStartOf(at);
  const slug = `weekly-exposure-${weekStart}`;
  const weekAgo = past.find((point) => point.label === "1주 전") ?? null;
  const drift = weekAgo ? current.exposure.effectivePercent - weekAgo.exposure.effectivePercent : null;

  const headline =
    drift === null
      ? `실효 노출 ${pct(current.exposure.effectivePercent)}`
      : drift === 0
        ? `실효 노출 ${pct(current.exposure.effectivePercent)}로 지난주와 같음`
        : `실효 노출이 ${signedPp(drift)} ${drift > 0 ? "늘어" : "줄어"} ${pct(current.exposure.effectivePercent)}`;

  const L: string[] = [];
  L.push(`# ${weekStart} 주간 점검`);
  L.push("");
  L.push(
    `${at.slice(0, 10)} 기준. 총 평가금액 ${won(current.totalKrw)}, 원금 대비 ${signedPct(facts.principalGainPercent)} (${signedWon(current.totalKrw - facts.principalKrw)}).`,
  );
  L.push("");

  // 1. 실효 노출
  L.push("## 실효 노출");
  L.push("");
  L.push(
    `레버리지 배수를 곱해 더한 값이다. 지수가 1% 움직이면 계좌는 약 ${(current.exposure.effectivePercent / 100).toFixed(2)}% 움직인다.`,
  );
  L.push("");
  L.push(`- **현재** — ${pct(current.exposure.effectivePercent)} (명목 ${pct(current.exposure.nominalPercent)})`);
  for (const point of past) {
    const diff = current.exposure.effectivePercent - point.exposure.effectivePercent;
    L.push(`- ${point.label} — ${pct(point.exposure.effectivePercent)} (지금은 ${signedPp(diff)})`);
  }
  L.push("");
  if (current.exposure.lines.length > 0) {
    for (const line of current.exposure.lines) {
      L.push(
        `- **${line.symbolId}** ${line.leverage}배 — 비중 ${pct(line.weightPercent)}, 실효 노출 ${pct(line.exposurePercent)}`,
      );
    }
  } else {
    L.push("배수가 잡힌 보유 종목이 없다.");
  }
  L.push("");

  // 2. 성격별 구성
  L.push("## 성격별 구성");
  L.push("");
  for (const line of current.themes) {
    const before = weekAgo ? themeWeight(weekAgo, line.theme) : null;
    const change = before === null ? "" : ` (1주 전 대비 ${signedPp(line.weightPercent - before)})`;
    L.push(`- **${line.label}** — ${pct(line.weightPercent)} · ${won(line.valueKrw)}, ${line.symbolIds.length}종목${change}`);
  }
  L.push("");

  // 3. 시점 비교
  if (past.length > 0) {
    L.push("## 시점 비교");
    L.push("");
    L.push(`- **현재** (${current.at.slice(0, 10)}) — 총 ${won(current.totalKrw)}, 실효 ${pct(current.exposure.effectivePercent)}`);
    for (const point of past) {
      L.push(
        `- ${point.label} (${point.at.slice(0, 10)}) — 총 ${won(point.totalKrw)}, 실효 ${pct(point.exposure.effectivePercent)}, 그때 이후 ${signedWon(current.totalKrw - point.totalKrw)}`,
      );
    }
    L.push("");
  }

  // 4. 종목별
  L.push("## 종목별");
  L.push("");
  if (holdings.length === 0) {
    L.push("보유 종목이 없다.");
  } else {
    for (const line of holdings) {
      L.push(
        `- **${line.symbolId}** ${line.name} — 비중 ${pct(line.weightPercent)}, ${won(line.valueKrw)}, 누적 ${signedPct(line.totalGainPercent)} (${signedWon(line.totalGainKrw)})`,
      );
    }
  }
  L.push("");

  // 5. 관찰 (사실만)
  L.push("## 관찰");
  L.push("");
  L.push(`- 최고점 대비 ${pct(facts.vsPeakPercent)}${facts.peakAt ? ` (최고 ${facts.peakAt.slice(0, 10)})` : ""}`);
  L.push(`- 이 구간 최대낙폭 ${pct(facts.maxDrawdown)}`);
  if (drift !== null) L.push(`- 실효 노출 주간 변화 ${signedPp(drift)}`);
  const cash = current.themes.find((line) => line.theme === "cash");
  if (cash) L.push(`- 현금 비중 ${pct(cash.weightPercent)}`);
  L.push("");
  L.push(
    "판단은 여기 적지 않는다. 무엇을 할지는 `투자철학`에 미리 적어 둔 원칙을 보고 정한다 — 이 글은 그때 숫자가 어땠는지만 남긴다.",
  );
  L.push("");

  // 6. 데이터 기준
  L.push("## 데이터 기준");
  L.push("");
  L.push("- 현재 값은 저장된 시세·환율로 계산한다. 리포트를 만든 시각 기준이다.");
  L.push(
    "- 과거 시점은 스냅샷에 종목별 구성이 없어서, 그 시점까지의 거래를 다시 돌려 수량을 구하고 그날 종가·환율로 평가한다. 비중의 분모는 추정하지 않고 그날 스냅샷의 실제 예탁자산을 쓴다.",
  );
  L.push("- 그날 종가를 모르는 종목은 추정하지 않고 뺀다.");
  for (const point of [current, ...past]) {
    if (Math.abs(point.unexplainedPercent) >= 1) {
      L.push(`  - ${point.label}: 종목별 합으로 설명되지 않은 몫 ${pct(point.unexplainedPercent)}`);
    }
  }
  L.push("- 배수표(`lib/domain/exposure.ts`)에 없는 종목은 전부 0으로 센다. 새 레버리지 상품을 샀다면 표에 먼저 적어야 이 숫자가 맞는다.");
  L.push("- 시황 해석과 매매 권고는 넣지 않는다. 외부 시장 정보를 읽지 않고, 그 판단은 자동 생성이 할 일이 아니다.");

  return {
    slug,
    title: `${weekStart} 주간 점검 — ${headline}`,
    summary:
      drift === null
        ? `실효 노출 ${pct(current.exposure.effectivePercent)}, 총 ${won(current.totalKrw)}, 원금 대비 ${signedPct(facts.principalGainPercent)}.`
        : `지난주 대비 ${signedPp(drift)}. 실효 노출 ${pct(current.exposure.effectivePercent)}, 총 ${won(current.totalKrw)}, 원금 대비 ${signedPct(facts.principalGainPercent)}.`,
    publishedAt: at.slice(0, 10),
    tags: ["자동생성", "노출", "구성"],
    body: `${L.join("\n")}\n`,
  };
}

/** 같은 주 리포트가 이미 있으면 갈아끼우고, 없으면 추가한다(최신이 앞). */
export function upsertWeeklyReport(existing: GeneratedReport[], report: GeneratedReport): GeneratedReport[] {
  const rest = existing.filter((item) => item.slug !== report.slug);
  return [report, ...rest].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
}
