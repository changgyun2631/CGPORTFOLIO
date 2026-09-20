import { describe, expect, it } from "vitest";
import { dedupeFlatSnapshots } from "../dedupe-snapshots.mjs";

describe("dedupeFlatSnapshots", () => {
  it("연속으로 총액·원금이 완전히 같은 점은 첫 점만 남긴다", () => {
    const snapshots = [
      { at: "2026-09-18T02:00:00Z", totalKrw: 100, principalKrw: 50, fxRate: 1300 },
      { at: "2026-09-18T08:00:00Z", totalKrw: 100, principalKrw: 50, fxRate: 1301 },
      { at: "2026-09-18T14:00:00Z", totalKrw: 100, principalKrw: 50, fxRate: 1299 },
      { at: "2026-09-18T20:00:00Z", totalKrw: 105, principalKrw: 50, fxRate: 1300 },
    ];

    expect(dedupeFlatSnapshots(snapshots)).toEqual([
      { at: "2026-09-18T02:00:00Z", totalKrw: 100, principalKrw: 50, fxRate: 1300 },
      { at: "2026-09-18T20:00:00Z", totalKrw: 105, principalKrw: 50, fxRate: 1300 },
    ]);
  });

  it("환율만 바뀐 건 중복으로 본다 — fxRate는 비교에서 뺀다", () => {
    const snapshots = [
      { at: "2026-09-19T02:00:00Z", totalKrw: 100, principalKrw: 50, fxRate: 1300 },
      { at: "2026-09-19T08:00:00Z", totalKrw: 100, principalKrw: 50, fxRate: 1320 },
    ];

    expect(dedupeFlatSnapshots(snapshots)).toEqual([
      { at: "2026-09-19T02:00:00Z", totalKrw: 100, principalKrw: 50, fxRate: 1300 },
    ]);
  });

  it("원금만 바뀌어도(입출금) 새 점으로 남긴다", () => {
    const snapshots = [
      { at: "2026-09-20T02:00:00Z", totalKrw: 100, principalKrw: 50, fxRate: 1300 },
      { at: "2026-09-20T08:00:00Z", totalKrw: 100, principalKrw: 60, fxRate: 1300 },
    ];

    expect(dedupeFlatSnapshots(snapshots)).toHaveLength(2);
  });

  it("빈 배열·한 개짜리는 그대로 돌려준다", () => {
    expect(dedupeFlatSnapshots([])).toEqual([]);
    const one = [{ at: "2026-09-20T02:00:00Z", totalKrw: 100, principalKrw: 50, fxRate: 1300 }];
    expect(dedupeFlatSnapshots(one)).toEqual(one);
  });
});
