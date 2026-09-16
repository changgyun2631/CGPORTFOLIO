import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { assertFileWithinLimits, assertRowCountWithinLimits, MAX_FILE_BYTES, MAX_ROWS } = await import("../limits");

function fakeFile(name: string, size: number): File {
  return new File([new Uint8Array(size)], name, { type: "text/csv" });
}

describe("assertFileWithinLimits", () => {
  it(".csv 확장자에 한도 이내 크기면 통과한다", () => {
    expect(() => assertFileWithinLimits(fakeFile("basis.csv", 1024), "보유종목 CSV")).not.toThrow();
  });

  it(".csv가 아니면 거부한다", () => {
    expect(() => assertFileWithinLimits(fakeFile("basis.txt", 10), "보유종목 CSV")).toThrow(".csv 파일만 지원합니다");
  });

  it("한도를 넘는 크기는 거부한다", () => {
    expect(() => assertFileWithinLimits(fakeFile("basis.csv", MAX_FILE_BYTES + 1), "보유종목 CSV")).toThrow("너무 큽니다");
  });

  it("한도와 정확히 같은 크기는 통과한다(경계값)", () => {
    expect(() => assertFileWithinLimits(fakeFile("basis.csv", MAX_FILE_BYTES), "보유종목 CSV")).not.toThrow();
  });
});

describe("assertRowCountWithinLimits", () => {
  it("한도 이내면 통과한다", () => {
    expect(() => assertRowCountWithinLimits(10, "보유종목 CSV")).not.toThrow();
  });

  it("한도를 넘으면 거부한다", () => {
    expect(() => assertRowCountWithinLimits(MAX_ROWS + 1, "보유종목 CSV")).toThrow("너무 많습니다");
  });
});
