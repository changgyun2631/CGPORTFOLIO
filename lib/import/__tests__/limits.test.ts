import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { assertFileWithinLimits, assertFileCountAndTotalWithinLimits, assertRowCountWithinLimits, MAX_FILE_BYTES, MAX_FILES, MAX_ROWS, MAX_TOTAL_BYTES } =
  await import("../limits");

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

describe("assertFileCountAndTotalWithinLimits", () => {
  it("단일 파일이면 통과한다", () => {
    expect(() => assertFileCountAndTotalWithinLimits([fakeFile("a.csv", 1024)], "계좌수익률 CSV")).not.toThrow();
  });

  it("파일 개수가 한도와 정확히 같으면 통과한다(경계값)", () => {
    const files = Array.from({ length: MAX_FILES }, (_, i) => fakeFile(`f${i}.csv`, 1024));
    expect(() => assertFileCountAndTotalWithinLimits(files, "계좌수익률 CSV")).not.toThrow();
  });

  it("파일 개수가 한도를 넘으면 거부한다", () => {
    const files = Array.from({ length: MAX_FILES + 1 }, (_, i) => fakeFile(`f${i}.csv`, 1024));
    expect(() => assertFileCountAndTotalWithinLimits(files, "계좌수익률 CSV")).toThrow("파일 개수가 너무 많습니다");
  });

  it("개수는 한도 이내여도 합산 크기가 넘으면 거부한다", () => {
    // 파일 하나당 한도(MAX_FILE_BYTES)는 넘지 않지만 두 개를 합치면 MAX_TOTAL_BYTES를 넘는 크기.
    const perFile = Math.ceil(MAX_TOTAL_BYTES / 2) + 1;
    const files = [fakeFile("a.csv", perFile), fakeFile("b.csv", perFile)];
    expect(() => assertFileCountAndTotalWithinLimits(files, "계좌수익률 CSV")).toThrow("합산 크기가 너무 큽니다");
  });

  it("합산 크기가 한도와 정확히 같으면 통과한다(경계값)", () => {
    const files = [fakeFile("a.csv", MAX_TOTAL_BYTES)];
    expect(() => assertFileCountAndTotalWithinLimits(files, "계좌수익률 CSV")).not.toThrow();
  });
});
