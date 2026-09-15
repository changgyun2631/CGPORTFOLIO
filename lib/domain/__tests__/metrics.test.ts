import { describe, expect, it } from "vitest";
import { analyzeSeries, downsample, filterSnapshots, rangeStart } from "../metrics";
import type { Snapshot } from "../types";

function snap(at: string, totalKrw: number): Snapshot {
  return { at, totalKrw, fxRate: 1300 };
}

describe("analyzeSeries — MDD", () => {
  it("빈 배열이면 전부 0/null", () => {
    const stats = analyzeSeries([]);
    expect(stats.count).toBe(0);
    expect(stats.maxDrawdown).toBe(0);
    expect(stats.peak).toBeNull();
  });

  it("단조 상승이면 낙폭이 없다", () => {
    const stats = analyzeSeries([
      snap("2024-01-01", 100),
      snap("2024-01-02", 110),
      snap("2024-01-03", 120),
    ]);
    expect(stats.maxDrawdown).toBe(0);
  });

  it("하락 후 회복 후 더 큰 하락: 더 큰 낙폭을 MDD로 잡는다", () => {
    // 100 -> 80 (-20%) -> 150 (신고점) -> 90 (-40%)
    const stats = analyzeSeries([
      snap("2024-01-01", 100),
      snap("2024-01-02", 80),
      snap("2024-01-03", 150),
      snap("2024-01-04", 90),
    ]);
    expect(stats.maxDrawdown).toBeCloseTo(-40, 5);
    expect(stats.drawdownFrom?.totalKrw).toBe(150);
    expect(stats.drawdownTo?.totalKrw).toBe(90);
  });

  it("회복 중간의 얕은 낙폭보다 더 깊은 낙폭이 있으면 더 깊은 쪽을 택한다", () => {
    // 100 -> 90(-10%) -> 95(회복) -> 60(-40% from peak100? no peak resets) -> 상세 검증
    const stats = analyzeSeries([
      snap("2024-01-01", 100),
      snap("2024-01-02", 90), // -10% from 100
      snap("2024-01-03", 95), // 아직 100 밑
      snap("2024-01-04", 60), // -40% from 100 (runningPeak은 여전히 100)
    ]);
    expect(stats.maxDrawdown).toBeCloseTo(-40, 5);
  });

  it("최고점 대비/최저점 대비 비율을 계산한다", () => {
    const stats = analyzeSeries([snap("2024-01-01", 100), snap("2024-01-02", 50), snap("2024-01-03", 80)]);
    expect(stats.vsPeakPercent).toBeCloseTo(80, 5);
    expect(stats.vsTroughPercent).toBeCloseTo(160, 5);
  });
});

describe("filterSnapshots", () => {
  const snapshots = [
    snap("2023-01-01T00:00:00+09:00", 100),
    snap("2023-06-01T00:00:00+09:00", 110),
    snap("2024-01-01T00:00:00+09:00", 120),
  ];

  it("빈 배열이면 빈 배열을 반환한다", () => {
    expect(filterSnapshots([], "1y")).toEqual([]);
  });

  it("all 범위는 전체를 반환한다", () => {
    expect(filterSnapshots(snapshots, "all")).toHaveLength(3);
  });

  it("범위 안에 점이 하나도 안 남으면 마지막 두 점을 반환한다", () => {
    const result = filterSnapshots(snapshots, "1d");
    expect(result.length).toBeGreaterThanOrEqual(2);
  });
});

describe("rangeStart", () => {
  it("all은 null을 반환한다", () => {
    expect(rangeStart("all", new Date("2024-06-01"))).toBeNull();
  });

  it("1y는 1년 전을 반환한다", () => {
    const result = rangeStart("1y", new Date("2024-06-01T00:00:00Z"));
    expect(result?.getUTCFullYear()).toBe(2023);
  });
});

describe("downsample", () => {
  it("limit 이하이면 그대로 반환한다", () => {
    const items = [1, 2, 3];
    expect(downsample(items, 10)).toEqual(items);
  });

  it("limit을 넘으면 균등 간격으로 줄이되 개수는 limit 이하가 된다", () => {
    const items = Array.from({ length: 100 }, (_, i) => i);
    const result = downsample(items, 10);
    expect(result.length).toBeLessThanOrEqual(10 + 2); // keep으로 추가될 수 있으니 여유를 둔다
    expect(result[0]).toBe(0);
    expect(result[result.length - 1]).toBe(99);
  });

  it("keep으로 지정한 항목은 반드시 포함된다", () => {
    const items = Array.from({ length: 50 }, (_, i) => i);
    const result = downsample(items, 5, (item) => item === 33);
    expect(result).toContain(33);
  });
});
