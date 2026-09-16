import { describe, expect, it } from "vitest";
import { fixSnapshotFxRates } from "../fix-snapshot-fx.mjs";

describe("fixSnapshotFxRates", () => {
  it("스냅샷 날짜에 맞는 환율로 fxRate만 바꾸고 나머지 필드는 그대로 둔다", () => {
    const snapshots = [
      { at: "2026-07-01T15:30:00+09:00", totalKrw: 100, principalKrw: 50, fxRate: 1350.04 },
      { at: "2026-07-02T15:30:00+09:00", totalKrw: 101, principalKrw: 50, fxRate: 1350.39 },
    ];
    const fxHistory = [
      { d: "2026-07-01", rate: 1350.93 },
      { d: "2026-07-02", rate: 1539.79 },
    ];

    expect(fixSnapshotFxRates(snapshots, fxHistory)).toEqual([
      { at: "2026-07-01T15:30:00+09:00", totalKrw: 100, principalKrw: 50, fxRate: 1350.93 },
      { at: "2026-07-02T15:30:00+09:00", totalKrw: 101, principalKrw: 50, fxRate: 1539.79 },
    ]);
  });

  it("환율 데이터에 없는 날짜는 그 이전 마지막 값을 쓴다", () => {
    const snapshots = [{ at: "2026-07-05T15:30:00+09:00", totalKrw: 100, fxRate: 999 }];
    const fxHistory = [
      { d: "2026-07-01", rate: 1350.93 },
      { d: "2026-07-03", rate: 1400 },
    ];

    expect(fixSnapshotFxRates(snapshots, fxHistory)).toEqual([
      { at: "2026-07-05T15:30:00+09:00", totalKrw: 100, fxRate: 1400 },
    ]);
  });

  it("fxHistory가 정렬 안 돼 있어도 날짜순으로 정렬해서 조회한다", () => {
    const snapshots = [{ at: "2026-07-02T15:30:00+09:00", totalKrw: 100, fxRate: 0 }];
    const fxHistory = [
      { d: "2026-07-02", rate: 1539.79 },
      { d: "2026-07-01", rate: 1350.93 },
    ];

    expect(fixSnapshotFxRates(snapshots, fxHistory)).toEqual([
      { at: "2026-07-02T15:30:00+09:00", totalKrw: 100, fxRate: 1539.79 },
    ]);
  });
});
