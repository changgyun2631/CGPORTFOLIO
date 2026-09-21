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

describe("parseCsvRows — 따옴표 안의 줄바꿈", () => {
  // 증권사 CSV는 헤더 이름에 줄바꿈을 넣어 내보내기도 한다(키움 2167 화면).
  // 줄바꿈으로 먼저 자르면 한 행이 두 줄로 쪼개져 열을 못 찾는다(2026-09-21).
  it("따옴표 안 줄바꿈은 값의 일부로 두고 한 행으로 읽는다", () => {
    const csv = '일자,예탁자산,"유가증권\n 평가금",입금,출금';
    expect(parseCsvRows(csv)).toEqual([["일자", "예탁자산", "유가증권\n 평가금", "입금", "출금"]]);
  });

  it("따옴표 밖 줄바꿈에서는 행을 끊는다", () => {
    expect(parseCsvRows("a,b\nc,d")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("CRLF와 빈 줄을 섞어도 행 수가 맞는다", () => {
    expect(parseCsvRows('a,"x\r\ny"\r\n\r\nb,c')).toEqual([
      ["a", "x\r\ny"],
      ["b", "c"],
    ]);
  });

  it("값 안의 이스케이프된 따옴표(\"\")를 유지한다", () => {
    expect(parseCsvRows('a,"he said ""hi"""')).toEqual([["a", 'he said "hi"']]);
  });
});
