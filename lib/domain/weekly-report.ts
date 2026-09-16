import type { ExposureSummary } from "./exposure";
import type { ReportMeta } from "./types";

/**
 * 주간 노출 리포트를 만든다. 매주 예약 실행이 이 함수로 그 주의 기록을 남긴다 —
 * 대시보드는 항상 "지금"만 보여주므로, 시간이 지난 뒤 "그때 어땠더라"를 되짚으려면
 * 그 시점 값을 얼려 둔 글이 따로 있어야 한다.
 *
 * 순수 함수다. 시각·수치는 전부 인자로 받고, 파일 쓰기는 호출하는 쪽이 한다.
 */

export type GeneratedReport = ReportMeta & { body: string };

export type WeeklyReportInput = {
  /** 리포트 기준 시각(ISO) */
  at: string;
  current: ExposureSummary;
  past: { label: string; summary: ExposureSummary }[];
};

/** 그 주의 월요일(KST 기준 날짜 문자열). 같은 주에 두 번 돌려도 같은 슬러그가 나온다. */
export function weekStartOf(at: string): string {
  const d = new Date(at);
  const day = (d.getDay() + 6) % 7; // 월요일=0
  d.setDate(d.getDate() - day);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function pct(value: number, digits = 1) {
  return `${value.toFixed(digits)}%`;
}

function signedPct(value: number, digits = 1) {
  return `${value > 0 ? "+" : ""}${value.toFixed(digits)}%p`;
}

export function buildWeeklyExposureReport({ at, current, past }: WeeklyReportInput): GeneratedReport {
  const weekStart = weekStartOf(at);
  const slug = `weekly-exposure-${weekStart}`;

  const weekAgo = past.find((point) => point.label === "1주 전");
  const drift = weekAgo ? current.effectivePercent - weekAgo.summary.effectivePercent : null;

  const headline =
    drift === null
      ? `실효 노출 ${pct(current.effectivePercent)}`
      : drift > 0
        ? `실효 노출이 ${signedPct(drift)} 늘어 ${pct(current.effectivePercent)}`
        : drift < 0
          ? `실효 노출이 ${signedPct(drift)} 줄어 ${pct(current.effectivePercent)}`
          : `실효 노출 ${pct(current.effectivePercent)}로 지난주와 같음`;

  const lines: string[] = [];
  lines.push(`# ${weekStart} 주간 노출 점검`);
  lines.push("");
  lines.push(
    `기준 ${at.slice(0, 10)}. 명목 비중이 아니라 레버리지 배수를 곱해 더한 값이다 — 지수가 1% 움직이면 계좌는 약 ${(current.effectivePercent / 100).toFixed(2)}% 움직인다.`,
  );
  lines.push("");

  lines.push("## 실효 노출");
  lines.push("");
  lines.push("| 시점 | 실효 노출 | 지난 시점 대비 |");
  lines.push("| --- | --- | --- |");
  lines.push(`| 현재 | ${pct(current.effectivePercent)} | — |`);
  for (const point of past) {
    const diff = current.effectivePercent - point.summary.effectivePercent;
    lines.push(`| ${point.label} | ${pct(point.summary.effectivePercent)} | ${signedPct(diff)} |`);
  }
  lines.push("");
  lines.push(`명목 비중 합은 ${pct(current.nominalPercent)}다.`);
  lines.push("");

  lines.push("## 배수가 잡힌 종목");
  lines.push("");
  if (current.lines.length === 0) {
    lines.push("배수가 잡힌 보유 종목이 없다.");
  } else {
    lines.push("| 종목 | 배수 | 비중 | 실효 노출 |");
    lines.push("| --- | --- | --- | --- |");
    for (const line of current.lines) {
      lines.push(
        `| ${line.symbolId} | ${line.leverage}x | ${pct(line.weightPercent)} | ${pct(line.exposurePercent)} |`,
      );
    }
    lines.push("");
    lines.push(
      "배수표(`lib/domain/exposure.ts`)에 없는 종목은 전부 0으로 센다. 새 레버리지 상품을 샀다면 표에 먼저 적어야 이 숫자가 맞는다.",
    );
  }

  return {
    slug,
    title: `${weekStart} 주간 노출 점검 — ${headline}`,
    summary:
      drift === null
        ? `실효 노출 ${pct(current.effectivePercent)}, 명목 비중 ${pct(current.nominalPercent)}.`
        : `지난주 대비 ${signedPct(drift)}. 실효 노출 ${pct(current.effectivePercent)}, 명목 비중 ${pct(current.nominalPercent)}.`,
    publishedAt: at.slice(0, 10),
    tags: ["자동생성", "노출"],
    body: `${lines.join("\n")}\n`,
  };
}

/** 같은 주 리포트가 이미 있으면 갈아끼우고, 없으면 추가한다(최신이 앞). */
export function upsertWeeklyReport(existing: GeneratedReport[], report: GeneratedReport): GeneratedReport[] {
  const rest = existing.filter((item) => item.slug !== report.slug);
  return [report, ...rest].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
}
