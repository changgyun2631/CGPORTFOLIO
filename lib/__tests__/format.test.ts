import { describe, expect, it } from "vitest";
import { dateLabel, daysHeld, daysHeldLabel, shortDateTime } from "../format";

describe("dateLabel", () => {
  it("날짜만 있는 문자열은 그대로 쓴다", () => {
    expect(dateLabel("2026-01-15")).toBe("2026-01-15");
  });

  it("시각이 있는 ISO는 shortDateTime과 같은 날짜를 가리킨다", () => {
    // 스냅샷은 CSV에서 온 `+09:00`과 cron이 쓴 `Z`가 섞여 있다. 앞 10자만 자르면
    // `Z` 쪽만 하루 어긋나서, 같은 시점을 차트 기간 표시와 툴팁이 다르게 보여줬다.
    for (const iso of ["2026-09-16T17:07:24.144Z", "2026-09-15T15:30:00+09:00"]) {
      const [month, day] = shortDateTime(iso).split(" ")[0].split("/");
      expect(dateLabel(iso).slice(5)).toBe(`${month}-${day}`);
    }
  });
});

describe("daysHeld", () => {
  const now = new Date("2026-09-21T10:00:00+09:00");

  it("달력 날짜끼리 센다 — 어제 산 것은 시각과 무관하게 1일이다", () => {
    expect(daysHeld("2026-09-20T23:50:00+09:00", now)).toBe(1);
  });

  it("같은 날이면 0일이다", () => {
    expect(daysHeld("2026-09-21T01:00:00+09:00", now)).toBe(0);
  });

  it("1년 전이면 365일이다", () => {
    expect(daysHeld("2025-09-21T09:30:00+09:00", now)).toBe(365);
  });
});

describe("daysHeldLabel", () => {
  const now = new Date("2026-09-21T10:00:00+09:00");

  it("오늘 산 것은 0일 대신 '오늘'로 적는다", () => {
    expect(daysHeldLabel("2026-09-21T09:30:00+09:00", now)).toBe("오늘");
  });

  it("긴 기간은 천 단위로 끊어 읽기 쉽게 한다", () => {
    expect(daysHeldLabel("2022-09-21T09:30:00+09:00", now)).toBe("1,461일");
  });

  it("취득 기록이 없으면 줄표로 둔다 — 0일로 적으면 오늘 산 것처럼 보인다", () => {
    expect(daysHeldLabel(null, now)).toBe("—");
    expect(daysHeldLabel("날짜 아님", now)).toBe("—");
  });
});
