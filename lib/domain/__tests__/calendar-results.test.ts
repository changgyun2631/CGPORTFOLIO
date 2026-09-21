import { describe, expect, it } from "vitest";
import { formatCalendarValue, seoulDate } from "../calendar-results";

describe("캘린더 표시", () => {
  it("한국 자정 기준으로 오늘을 나눈다", () => {
    expect(seoulDate(new Date("2026-09-21T15:01:00Z"))).toBe("2026-09-22");
  });
  it("미발표와 0을 구분하고 %p 차이를 소수로 표시한다", () => {
    expect(formatCalendarValue(null, "%")).toBe("—");
    expect(formatCalendarValue(0, "%")).toBe("0 %");
    expect(formatCalendarValue(0.12, "%p")).toBe("0.12 %p");
    expect(formatCalendarValue(NaN, "USD")).toBe("—");
  });
  it("큰 금액은 모바일에서도 읽을 수 있는 단위로 표시한다", () => {
    expect(formatCalendarValue(13500000000, "USD")).toBe("135억 USD");
    expect(formatCalendarValue(-1500000000, "USD")).toBe("-15억 USD");
    expect(formatCalendarValue(2.4, "USD/주")).toBe("2.4 USD/주");
  });
});
