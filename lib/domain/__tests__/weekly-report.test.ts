import { describe, expect, it } from "vitest";
import { summarizeComposition } from "../composition";
import { summarizeQqqExposure } from "../exposure";
import {
  buildWeeklyExposureReport,
  upsertWeeklyReport,
  weekStartOf,
  type GeneratedReport,
  type PointInTime,
  type WeeklyReportInput,
} from "../weekly-report";

/** QLD(2배)로 목표 실효 노출을 만든 시점 하나. */
function point(label: string, at: string, effectivePercent: number, totalKrw = 1000): PointInTime {
  const qldValue = (totalKrw * effectivePercent) / 200;
  const entries = [
    { symbolId: "QLD", kind: "etf" as const, valueKrw: qldValue },
    { symbolId: "NVDA", kind: "stock" as const, valueKrw: totalKrw - qldValue },
  ];
  return {
    label,
    at,
    totalKrw,
    exposure: summarizeQqqExposure(at, totalKrw, entries),
    themes: summarizeComposition(entries, totalKrw),
    unexplainedPercent: 0,
  };
}

const baseInput: WeeklyReportInput = {
  at: "2026-09-17T02:00:00+09:00",
  current: point("현재", "2026-09-17T02:00:00+09:00", 35),
  past: [point("1주 전", "2026-09-10T15:30:00+09:00", 30), point("4주 전", "2026-08-20T15:30:00+09:00", 20)],
  holdings: [
    {
      symbolId: "QLD", name: "QQQ 2배", shares: 10, valueKrw: 175,
      weightPercent: 17.5, totalGainPercent: 12.5, totalGainKrw: 20,
    },
  ],
  facts: {
    vsPeakPercent: 85.6, maxDrawdown: -20.17, peakAt: "2026-06-30T15:30:00+09:00",
    principalKrw: 800, principalGainPercent: 25,
  },
};

describe("weekStartOf", () => {
  it("같은 주 어느 날에 돌려도 그 주 월요일을 가리킨다", () => {
    const monday = weekStartOf("2026-09-14T09:00:00+09:00");
    expect(weekStartOf("2026-09-17T23:00:00+09:00")).toBe(monday);
    expect(weekStartOf("2026-09-20T23:00:00+09:00")).toBe(monday);
    expect(weekStartOf("2026-09-21T00:30:00+09:00")).not.toBe(monday);
  });
});

describe("buildWeeklyExposureReport", () => {
  it("지난주 대비 증감을 제목과 요약에 적는다", () => {
    const up = buildWeeklyExposureReport(baseInput);
    expect(up.title).toContain("늘어");
    expect(up.summary).toContain("+5.0%p");

    const down = buildWeeklyExposureReport({ ...baseInput, current: point("현재", baseInput.at, 25) });
    expect(down.title).toContain("줄어");
  });

  it("슬러그는 그 주 월요일, 발행일은 실행일이다", () => {
    const report = buildWeeklyExposureReport(baseInput);
    expect(report.slug).toBe("weekly-exposure-2026-09-14");
    expect(report.publishedAt).toBe("2026-09-17");
  });

  it("필요한 절이 다 들어간다", () => {
    const body = buildWeeklyExposureReport(baseInput).body;
    for (const heading of ["## 실효 노출", "## 성격별 구성", "## 시점 비교", "## 종목별", "## 관찰", "## 데이터 기준"]) {
      expect(body).toContain(heading);
    }
  });

  it("성격별 구성에 1주 전 대비 변화를 같이 적는다", () => {
    const body = buildWeeklyExposureReport(baseInput).body;
    expect(body).toContain("**레버리지**");
    expect(body).toContain("1주 전 대비 +2.5%p");
  });

  it("관찰에는 사실만 적고 매매 판단은 넣지 않는다", () => {
    const body = buildWeeklyExposureReport(baseInput).body;
    expect(body).toContain("최고점 대비 85.6%");
    expect(body).toContain("최대낙폭 -20.2%");
    expect(body).not.toMatch(/매수 권고|매도 권고|사야|팔아야|추천/);
  });

  it("과거 재구성이 설명 못 한 몫이 크면 데이터 기준에 밝힌다", () => {
    const shaky = { ...baseInput.past[0], unexplainedPercent: 12.3 };
    const body = buildWeeklyExposureReport({ ...baseInput, past: [shaky] }).body;
    expect(body).toContain("설명되지 않은 몫 12.3%");
  });

  it("설명 못 한 몫이 작으면 굳이 적지 않는다", () => {
    const body = buildWeeklyExposureReport(baseInput).body;
    expect(body).not.toContain("설명되지 않은 몫");
  });

  it("비교할 과거 시점이 없어도 만들어진다", () => {
    const report = buildWeeklyExposureReport({ ...baseInput, past: [] });
    expect(report.summary).not.toContain("지난주 대비");
    expect(report.body).not.toContain("## 시점 비교");
  });

  it("수익률은 %, 비중 차이는 %p로 적는다", () => {
    const report = buildWeeklyExposureReport(baseInput);
    expect(report.summary).toContain("원금 대비 +25.0%.");
    expect(report.summary).toContain("지난주 대비 +5.0%p.");
    expect(report.body).toContain("누적 +12.5% ");
  });

  it("렌더러가 못 읽는 표 문법은 쓰지 않는다", () => {
    expect(buildWeeklyExposureReport(baseInput).body).not.toMatch(/^\|/m);
  });
});

describe("upsertWeeklyReport", () => {
  const report = (slug: string, publishedAt: string): GeneratedReport => ({
    slug, title: slug, summary: "", publishedAt, body: "",
  });

  it("같은 주를 다시 돌리면 갈아끼우고 늘어나지 않는다", () => {
    const next = upsertWeeklyReport(
      [report("weekly-exposure-2026-09-14", "2026-09-15")],
      report("weekly-exposure-2026-09-14", "2026-09-17"),
    );
    expect(next).toHaveLength(1);
    expect(next[0].publishedAt).toBe("2026-09-17");
  });

  it("다른 주는 추가하고 최신이 앞에 온다", () => {
    const next = upsertWeeklyReport(
      [report("weekly-exposure-2026-09-07", "2026-09-07")],
      report("weekly-exposure-2026-09-14", "2026-09-14"),
    );
    expect(next.map((r) => r.publishedAt)).toEqual(["2026-09-14", "2026-09-07"]);
  });
});
