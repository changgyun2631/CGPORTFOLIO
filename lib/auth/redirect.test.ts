import { describe, expect, it } from "vitest";

import { safeReturnPath } from "./redirect";

describe("로그인 뒤 돌아갈 주소", () => {
  it("사이트 내부 화면과 쿼리스트링은 유지한다", () => {
    expect(safeReturnPath("/history?range=1y")).toBe("/history?range=1y");
  });

  it.each([
    ["https://evil.example", "/"],
    ["//evil.example", "/"],
    ["/\\evil", "/"],
    ["/login?next=/", "/"],
    ["/api/private", "/"],
    [null, "/"],
  ])("외부·인증·API 주소 %p는 홈으로 바꾼다", (value, expected) => {
    expect(safeReturnPath(value)).toBe(expected);
  });
});
