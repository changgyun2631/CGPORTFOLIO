import { describe, expect, it } from "vitest";
import { analyzeSeries, downsample, filterSnapshots, rangeStart, ranges } from "../metrics";
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

  it("빈 배열이면 빈 배열을 반환하고 fallback은 아니다", () => {
    expect(filterSnapshots([], "1y")).toEqual({ snapshots: [], usedFallback: false, shortOfRange: false });
  });

  it("all 범위는 전체를 반환하고 fallback은 아니다", () => {
    const result = filterSnapshots(snapshots, "all");
    expect(result.snapshots).toHaveLength(3);
    expect(result.usedFallback).toBe(false);
    expect(result.shortOfRange).toBe(false);
  });

  it("기록에 공백이 있어 구간 앞부분이 비면 shortOfRange로 알린다", () => {
    // 마지막 며칠치만 촘촘하고 그 앞은 한 달 넘게 비어 있는 실제 모양.
    const gapped = [
      snap("2026-06-20T15:30:00+09:00", 90),
      snap("2026-08-10T15:30:00+09:00", 100),
      snap("2026-09-15T21:00:00Z", 110),
      snap("2026-09-16T05:07:00Z", 111),
      snap("2026-09-16T17:07:00Z", 112),
    ];

    // "1개월"은 점이 여러 개라 fallback은 아니지만, 실제로는 이틀치만 덮는다.
    const month = filterSnapshots(gapped, "1m");
    expect(month.usedFallback).toBe(false);
    expect(month.shortOfRange).toBe(true);
    expect(month.snapshots).toHaveLength(3);

    // "3개월"은 2026-06-20까지 닿으므로 구간을 충분히 덮는다.
    const quarter = filterSnapshots(gapped, "3m");
    expect(quarter.shortOfRange).toBe(false);
    expect(quarter.snapshots).toHaveLength(5);
  });

  it("1일 범위에 실제 점이 부족하면 마지막 두 관측값을 fallback으로 반환한다", () => {
    const result = filterSnapshots(snapshots, "1d");
    expect(result.snapshots).toEqual(snapshots.slice(-2));
    expect(result.usedFallback).toBe(true);
  });

  it("달력 구간에 점이 2개 이상 있으면 fallback이 아니다", () => {
    const dense = [
      snap("2024-06-01T00:00:00+09:00", 100),
      snap("2024-06-05T00:00:00+09:00", 105),
      snap("2024-06-10T00:00:00+09:00", 110),
    ];
    const result = filterSnapshots(dense, "1y");
    expect(result.usedFallback).toBe(false);
    expect(result.snapshots).toHaveLength(3);
  });

  it("짧은 달력 구간이 비어도 기간별로 서로 다른 실제 관측값 수를 쓰고, 전부 fallback으로 표시한다", () => {
    const sparse = [
      ...Array.from({ length: 40 }, (_, index) =>
        snap(new Date(Date.UTC(2026, 6, index + 1)).toISOString(), 100 + index),
      ),
      snap("2026-09-15T00:00:00.000Z", 150),
    ];

    const oneDay = filterSnapshots(sparse, "1d");
    const sevenDay = filterSnapshots(sparse, "7d");
    const oneMonth = filterSnapshots(sparse, "1m");

    expect(oneDay.snapshots).toHaveLength(2);
    expect(oneDay.usedFallback).toBe(true);
    expect(sevenDay.snapshots).toHaveLength(7);
    expect(sevenDay.usedFallback).toBe(true);
    expect(oneMonth.snapshots).toHaveLength(30);
    expect(oneMonth.usedFallback).toBe(true);
  });

  it("fallback으로 반환된 관측값의 실제 시작일은 화면이 직접 읽을 수 있다 — 달력 구간과 다를 수 있음", () => {
    const sparse = [
      snap("2026-01-01T00:00:00Z", 100),
      snap("2026-09-15T00:00:00Z", 150),
    ];
    const result = filterSnapshots(sparse, "7d");
    expect(result.usedFallback).toBe(true);
    // "7일" 버튼을 눌렀지만 실제 시작일은 8개월도 더 전이다 — 이게 P1-5가 밝히려는 사실.
    expect(result.snapshots[0].at).toBe("2026-01-01T00:00:00Z");
  });
});

describe("기간 탭별 지표 카드 — 최고점·최저점·MDD·현재/최고·현재/최저", () => {
  // 하루 간격 800일: 상승 -> 급락 -> 회복. 어떤 기간 탭을 눌러도 그 구간 안에
  // 고점·저점·낙폭이 생기도록 일부러 굴곡을 넣는다.
  const daily: Snapshot[] = Array.from({ length: 800 }, (_, i) => {
    const at = new Date(Date.UTC(2024, 6, 1 + i, 6, 30)).toISOString();
    const wave = Math.sin(i / 37) * 18 + Math.sin(i / 11) * 6;
    return snap(at, Math.round(1000 + i * 1.5 + wave * 10));
  });

  for (const { key, label } of ranges) {
    it(`${label} 탭의 다섯 값이 그 구간 스냅샷만으로 다시 계산한 값과 같다`, () => {
      const { snapshots: filtered } = filterSnapshots(daily, key);
      const stats = analyzeSeries(filtered);

      // 화면과 같은 입력(구간 스냅샷 전체)을 독립적으로 다시 집계한다.
      const totals = filtered.map((s) => s.totalKrw);
      const last = totals[totals.length - 1];
      const expectedPeak = Math.max(...totals);
      const expectedTrough = Math.min(...totals);

      let runningPeak = totals[0];
      let expectedMdd = 0;
      for (const total of totals) {
        runningPeak = Math.max(runningPeak, total);
        expectedMdd = Math.min(expectedMdd, ((total - runningPeak) / runningPeak) * 100);
      }

      expect(stats.peak?.totalKrw).toBe(expectedPeak);
      expect(stats.trough?.totalKrw).toBe(expectedTrough);
      expect(stats.maxDrawdown).toBeCloseTo(expectedMdd, 9);
      expect(stats.vsPeakPercent).toBeCloseTo((last / expectedPeak) * 100, 9);
      expect(stats.vsPeakAmount).toBe(last - expectedPeak);
      expect(stats.vsTroughPercent).toBeCloseTo((last / expectedTrough) * 100, 9);
      expect(stats.vsTroughAmount).toBe(last - expectedTrough);
    });
  }

  it("구간이 좁아질수록 최고점은 낮아지지 않고 최저점은 높아지지 않는다", () => {
    const all = analyzeSeries(filterSnapshots(daily, "all").snapshots);
    const year = analyzeSeries(filterSnapshots(daily, "1y").snapshots);
    const month = analyzeSeries(filterSnapshots(daily, "1m").snapshots);

    expect(all.peak!.totalKrw).toBeGreaterThanOrEqual(year.peak!.totalKrw);
    expect(year.peak!.totalKrw).toBeGreaterThanOrEqual(month.peak!.totalKrw);
    expect(all.trough!.totalKrw).toBeLessThanOrEqual(year.trough!.totalKrw);
    expect(year.trough!.totalKrw).toBeLessThanOrEqual(month.trough!.totalKrw);
    // 마지막 값은 구간과 무관하게 같으므로 현재/최고는 구간이 좁을수록 100%에 가깝다.
    expect(month.vsPeakPercent).toBeGreaterThanOrEqual(year.vsPeakPercent);
  });

  it("현재/최고와 현재/최저는 비율(100% 기준)이지 증감률이 아니다", () => {
    const stats = analyzeSeries([snap("2026-01-01", 100), snap("2026-01-02", 200), snap("2026-01-03", 150)]);
    expect(stats.vsPeakPercent).toBeCloseTo(75, 9); // 150/200
    expect(stats.vsPeakAmount).toBe(-50);
    expect(stats.vsTroughPercent).toBeCloseTo(150, 9); // 150/100
    expect(stats.vsTroughAmount).toBe(50);
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
