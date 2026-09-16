import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { hashDataFiles, diffDataFiles } = await import("../data-version");

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "data-version-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("hashDataFiles", () => {
  it("같은 내용이면 같은 해시를 낸다", () => {
    writeFileSync(join(dir, "a.json"), "[1,2,3]");
    const first = hashDataFiles(dir, ["a.json"]);
    const second = hashDataFiles(dir, ["a.json"]);
    expect(first["a.json"]).toBe(second["a.json"]);
  });

  it("내용이 바뀌면 해시도 바뀐다", () => {
    writeFileSync(join(dir, "a.json"), "[1]");
    const before = hashDataFiles(dir, ["a.json"]);
    writeFileSync(join(dir, "a.json"), "[1,2]");
    const after = hashDataFiles(dir, ["a.json"]);
    expect(before["a.json"]).not.toBe(after["a.json"]);
  });

  it("파일이 없으면 존재 여부를 구분할 수 있는 마커를 쓴다", () => {
    const result = hashDataFiles(dir, ["missing.json"]);
    expect(result["missing.json"]).toBe("__missing__");
  });
});

describe("diffDataFiles", () => {
  it("전부 같으면 빈 배열을 낸다", () => {
    const snapshot = { "a.json": "x", "b.json": "y" };
    expect(diffDataFiles(snapshot, { ...snapshot })).toEqual([]);
  });

  it("바뀐 파일 이름만 골라낸다", () => {
    const baseline = { "a.json": "x", "b.json": "y" };
    const current = { "a.json": "x", "b.json": "z" };
    expect(diffDataFiles(baseline, current)).toEqual(["b.json"]);
  });
});
