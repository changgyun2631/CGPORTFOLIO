import { describe, expect, it } from "vitest";
import { dedupeFlatSnapshots, dedupeWeekendRuns } from "../dedupe-snapshots.mjs";

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

describe("dedupeWeekendRuns", () => {
  it("같은 주말(KST 토·일) 구간의 첫 점만 남기고, 값이 조금씩 달라도 나머지는 지운다", () => {
    // 2026-09-18(금) 23:07Z = 09-19(토) 08:07 KST부터 2026-09-20(일) 17:07Z = 09-21(월) 02:07 KST까지
    // — 실제로 주말 내내 총액이 미세하게 계속 바뀐 걸 확인한 운영 사례를 그대로 흉내낸다.
    const snapshots = [
      { at: "2026-09-18T05:07:00Z", totalKrw: 100, fxRate: 1385 }, // 금요일 — 평일
      { at: "2026-09-18T23:07:00Z", totalKrw: 101, fxRate: 1387 }, // 토요일 08:07 KST — 주말 첫 점
      { at: "2026-09-19T05:07:00Z", totalKrw: 102, fxRate: 1386.9 }, // 토요일 — 지워야 함
      { at: "2026-09-19T17:07:00Z", totalKrw: 103, fxRate: 1387.4 }, // 일요일 — 지워야 함
      { at: "2026-09-20T17:07:00Z", totalKrw: 104, fxRate: 1387.4 }, // 월요일 02:07 KST — 평일, 남는다
    ];

    expect(dedupeWeekendRuns(snapshots)).toEqual([
      { at: "2026-09-18T05:07:00Z", totalKrw: 100, fxRate: 1385 },
      { at: "2026-09-18T23:07:00Z", totalKrw: 101, fxRate: 1387 },
      { at: "2026-09-20T17:07:00Z", totalKrw: 104, fxRate: 1387.4 },
    ]);
  });

  it("평일끼리는 값이 같아도 건드리지 않는다(이건 dedupeFlatSnapshots의 일)", () => {
    const snapshots = [
      { at: "2026-09-15T02:00:00Z", totalKrw: 100 }, // 화요일 11시 KST
      { at: "2026-09-15T08:00:00Z", totalKrw: 100 }, // 화요일 17시 KST
    ];
    expect(dedupeWeekendRuns(snapshots)).toEqual(snapshots);
  });

  it("빈 배열·한 개짜리는 그대로 돌려준다", () => {
    expect(dedupeWeekendRuns([])).toEqual([]);
    const one = [{ at: "2026-09-19T05:07:00Z", totalKrw: 100 }];
    expect(dedupeWeekendRuns(one)).toEqual(one);
  });
});
