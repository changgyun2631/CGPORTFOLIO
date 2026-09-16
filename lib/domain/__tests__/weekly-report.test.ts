import { describe, expect, it } from "vitest";
import { summarizeQqqExposure } from "../exposure";
import { buildWeeklyExposureReport, upsertWeeklyReport, weekStartOf, type GeneratedReport } from "../weekly-report";

function exposure(effectivePercentTarget: number) {
  // QLD(2배)로 목표 실효 노출을 만든다.
  const weight = effectivePercentTarget / 2;
  return summarizeQqqExposure("2026-09-17T00:00:00+09:00", 1000, [{ symbolId: "QLD", valueKrw: 10 * weight }]);
}

describe("weekStartOf", () => {
  it("같은 주 어느 날에 돌려도 그 주 월요일을 가리킨다", () => {
    const monday = weekStartOf("2026-09-14T09:00:00+09:00");
    expect(weekStartOf("2026-09-17T23:00:00+09:00")).toBe(monday);
    expect(weekStartOf("2026-09-20T23:00:00+09:00")).toBe(monday);
  });

  it("일요일은 그 주 월요일로, 다음 월요일은 새 주로 넘어간다", () => {
    const monday = weekStartOf("2026-09-14T09:00:00+09:00");
    expect(weekStartOf("2026-09-20T12:00:00+09:00")).toBe(monday);
    expect(weekStartOf("2026-09-21T00:30:00+09:00")).not.toBe(monday);
  });
});

describe("buildWeeklyExposureReport", () => {
  const past = [
    { label: "1주 전", summary: exposure(30) },
    { label: "4주 전", summary: exposure(20) },
  ];

  it("지난주보다 늘면 제목에 증가로 적는다", () => {
    const report = buildWeeklyExposureReport({ at: "2026-09-17T02:00:00+09:00", current: exposure(35), past });
    expect(report.title).toContain("늘어");
    expect(report.summary).toContain("+5.0%p");
    expect(report.slug).toBe("weekly-exposure-2026-09-14");
    expect(report.publishedAt).toBe("2026-09-17");
  });

  it("지난주보다 줄면 감소로 적는다", () => {
    const report = buildWeeklyExposureReport({ at: "2026-09-17T02:00:00+09:00", current: exposure(25), past });
    expect(report.title).toContain("줄어");
    expect(report.summary).toContain("-5.0%p");
  });

  it("본문에 시점 표와 종목 표가 들어간다", () => {
    const report = buildWeeklyExposureReport({ at: "2026-09-17T02:00:00+09:00", current: exposure(35), past });
    expect(report.body).toContain("| 현재 | 35.0% |");
    expect(report.body).toContain("| 1주 전 | 30.0% | +5.0%p |");
    expect(report.body).toContain("| QLD | 2x |");
  });

  it("비교할 과거 시점이 없어도 만들어진다", () => {
    const report = buildWeeklyExposureReport({ at: "2026-09-17T02:00:00+09:00", current: exposure(35), past: [] });
    expect(report.title).toContain("35.0%");
    expect(report.summary).not.toContain("%p");
  });

  it("배수가 잡힌 종목이 없으면 그렇게 적는다", () => {
    const empty = summarizeQqqExposure("2026-09-17", 1000, [{ symbolId: "NVDA", valueKrw: 1000 }]);
    const report = buildWeeklyExposureReport({ at: "2026-09-17T02:00:00+09:00", current: empty, past: [] });
    expect(report.body).toContain("배수가 잡힌 보유 종목이 없다");
  });
});

describe("upsertWeeklyReport", () => {
  const report = (slug: string, publishedAt: string): GeneratedReport => ({
    slug, title: slug, summary: "", publishedAt, body: "",
  });

  it("같은 주를 다시 돌리면 갈아끼우고 늘어나지 않는다", () => {
    const existing = [report("weekly-exposure-2026-09-14", "2026-09-15")];
    const next = upsertWeeklyReport(existing, report("weekly-exposure-2026-09-14", "2026-09-17"));
    expect(next).toHaveLength(1);
    expect(next[0].publishedAt).toBe("2026-09-17");
  });

  it("다른 주는 추가하고 최신이 앞에 온다", () => {
    const existing = [report("weekly-exposure-2026-09-07", "2026-09-07")];
    const next = upsertWeeklyReport(existing, report("weekly-exposure-2026-09-14", "2026-09-14"));
    expect(next.map((r) => r.publishedAt)).toEqual(["2026-09-14", "2026-09-07"]);
  });
});
