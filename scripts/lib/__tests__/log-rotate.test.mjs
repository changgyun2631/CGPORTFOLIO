import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { trimLogFile } from "../log-rotate.mjs";

describe("trimLogFile", () => {
  let dir;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("파일이 없으면 아무것도 안 한다", () => {
    dir = mkdtempSync(join(tmpdir(), "log-rotate-"));
    const path = join(dir, "no-such.log");
    expect(() => trimLogFile(path, 10)).not.toThrow();
    expect(existsSync(path)).toBe(false);
  });

  it("줄 수가 한도 이하면 그대로 둔다", () => {
    dir = mkdtempSync(join(tmpdir(), "log-rotate-"));
    const path = join(dir, "a.log");
    writeFileSync(path, "1\n2\n3\n");
    trimLogFile(path, 10);
    expect(readFileSync(path, "utf8")).toBe("1\n2\n3\n");
  });

  it("한도를 넘으면 최근 N줄만 남긴다", () => {
    dir = mkdtempSync(join(tmpdir(), "log-rotate-"));
    const path = join(dir, "a.log");
    writeFileSync(path, Array.from({ length: 100 }, (_, i) => `line-${i}`).join("\n"));
    trimLogFile(path, 10);
    const remaining = readFileSync(path, "utf8").trim().split("\n");
    expect(remaining).toHaveLength(10);
    expect(remaining[0]).toBe("line-90");
    expect(remaining[9]).toBe("line-99");
  });
});
