import { describe, expect, it } from "vitest";

import { assessFreshness, earliestAsOf, isUsMarketHours } from "../freshness";

describe("isUsMarketHours", () => {
  it("평일 정규장 중이면 true", () => {
    // 2024-01-10(수) 10:00 America/New_York(겨울, UTC-5) = 15:00Z
    expect(isUsMarketHours(new Date("2024-01-10T15:00:00Z"))).toBe(true);
  });

  it("평일 장 마감 후면 false", () => {
    // 같은 수요일 20:00 NY = 다음날 01:00Z
    expect(isUsMarketHours(new Date("2024-01-11T01:00:00Z"))).toBe(false);
  });

  it("개장 시각(09:30) 경계는 장중으로 본다", () => {
    expect(isUsMarketHours(new Date("2024-01-10T14:30:00Z"))).toBe(true);
  });

  it("폐장 시각(16:00) 경계는 장 마감으로 본다", () => {
    expect(isUsMarketHours(new Date("2024-01-10T21:00:00Z"))).toBe(false);
  });

  it("주말이면 시간과 무관하게 false", () => {
    // 2024-01-13(토) 정오 NY = 17:00Z
    expect(isUsMarketHours(new Date("2024-01-13T17:00:00Z"))).toBe(false);
  });

  it("서머타임(EDT, UTC-4) 중에도 정확히 판정한다", () => {
    // 2024-07-10(수) 09:30 NY(여름, UTC-4) = 13:30Z
    expect(isUsMarketHours(new Date("2024-07-10T13:30:00Z"))).toBe(true);
  });
});

describe("earliestAsOf", () => {
  it("가장 오래된 값을 고른다 — 배치 중 일부만 갱신 실패해도 잡아낸다", () => {
    expect(earliestAsOf(["2024-01-03T00:00:00Z", "2024-01-01T00:00:00Z", "2024-01-05T00:00:00Z"])).toBe(
      "2024-01-01T00:00:00Z",
    );
  });

  it("null/undefined/빈 문자열은 무시한다", () => {
    expect(earliestAsOf([null, undefined, "", "2024-01-01T00:00:00Z"])).toBe("2024-01-01T00:00:00Z");
  });

  it("유효한 값이 하나도 없으면 null이다", () => {
    expect(earliestAsOf([null, undefined])).toBeNull();
  });
});

describe("assessFreshness", () => {
  // 장 마감 시간대(주말)로 고정해 "시세/원금" 임계시간이 48시간이 되게 한다.
  const now = new Date("2024-01-13T12:00:00Z"); // 토요일 정오

  it("정상: 최근에 갱신된 값은 fresh다", () => {
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
    const [quote, basis, principal] = assessFreshness(
      { quoteAsOf: oneHourAgo, basisAsOf: oneHourAgo, principalAsOf: oneHourAgo },
      now,
    );
    expect(quote.level).toBe("fresh");
    expect(basis.level).toBe("fresh");
    expect(principal.level).toBe("fresh");
  });

  it("경계: 임계시간과 정확히 같으면 아직 fresh다", () => {
    const exactlyAtThreshold = new Date(now.getTime() - 48 * 60 * 60 * 1000).toISOString();
    const [quote] = assessFreshness({ quoteAsOf: exactlyAtThreshold, basisAsOf: null, principalAsOf: null }, now);
    expect(quote.level).toBe("fresh");
  });

  it("경계: 임계시간을 1분이라도 넘으면 stale이다", () => {
    const justOverThreshold = new Date(now.getTime() - (48 * 60 + 1) * 60 * 1000).toISOString();
    const [quote] = assessFreshness({ quoteAsOf: justOverThreshold, basisAsOf: null, principalAsOf: null }, now);
    expect(quote.level).toBe("stale");
  });

  it("오래된 값은 stale이다", () => {
    const wayOld = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000).toISOString();
    const [quote, basis, principal] = assessFreshness(
      { quoteAsOf: wayOld, basisAsOf: wayOld, principalAsOf: wayOld },
      now,
    );
    expect(quote.level).toBe("stale");
    expect(basis.level).toBe("stale");
    expect(principal.level).toBe("stale");
  });

  it("값이 없으면 missing이다", () => {
    const [quote, basis, principal] = assessFreshness({ quoteAsOf: null, basisAsOf: null, principalAsOf: null }, now);
    expect(quote.level).toBe("missing");
    expect(basis.level).toBe("missing");
    expect(principal.level).toBe("missing");
  });

  it("잔고는 30일(720시간) 기준으로 훨씬 느슨하다 — 시세라면 stale일 시점에도 fresh", () => {
    const tenDaysAgo = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000).toISOString();
    const [quote, basis] = assessFreshness({ quoteAsOf: tenDaysAgo, basisAsOf: tenDaysAgo, principalAsOf: null }, now);
    expect(quote.level).toBe("stale");
    expect(basis.level).toBe("fresh");
  });

  it("장중에는 시세 임계시간이 8시간으로 더 빡빡하다", () => {
    const marketOpenNow = new Date("2024-01-10T18:00:00Z"); // 수요일 13:00 NY, 장중
    const tenHoursAgo = new Date(marketOpenNow.getTime() - 10 * 60 * 60 * 1000).toISOString();
    const [quote] = assessFreshness({ quoteAsOf: tenHoursAgo, basisAsOf: null, principalAsOf: null }, marketOpenNow);
    expect(quote.level).toBe("stale");
  });
});
