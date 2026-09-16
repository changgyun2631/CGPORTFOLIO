import { describe, expect, it } from "vitest";

import { parseCsvLine, parseCsvRows, parseNumber } from "../csv.mjs";

describe("parseCsvLine", () => {
  it("쉼표로 구분된 필드를 나눈다", () => {
    expect(parseCsvLine("a,b,c")).toEqual(["a", "b", "c"]);
  });

  it("따옴표 안의 쉼표는 필드 구분자로 보지 않는다", () => {
    expect(parseCsvLine('a,"b,c",d')).toEqual(["a", "b,c", "d"]);
  });

  it("이스케이프된 이중 따옴표를 하나로 되돌린다", () => {
    expect(parseCsvLine('a,"say ""hi""",c')).toEqual(["a", 'say "hi"', "c"]);
  });
});

describe("parseCsvRows", () => {
  it("줄바꿈으로 행을 나누고 빈 줄은 버린다", () => {
    expect(parseCsvRows("a,b\r\n\r\nc,d\n")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });
});

describe("parseNumber", () => {
  it("천단위 콤마와 % 기호를 제거하고 숫자로 만든다", () => {
    expect(parseNumber("1,234")).toBe(1234);
    expect(parseNumber("12%")).toBe(12);
    expect(parseNumber(" 500 ")).toBe(500);
  });

  it("빈 값·undefined는 0이다", () => {
    expect(parseNumber("")).toBe(0);
    expect(parseNumber(undefined)).toBe(0);
  });
});
