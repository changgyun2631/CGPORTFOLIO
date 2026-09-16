import { describe, expect, it } from "vitest";
import { dateLabel, shortDateTime } from "../format";

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
