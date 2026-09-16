import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { backupData } from "../backup.mjs";

describe("backupData", () => {
  let dataDir;
  let backupRoot;

  afterEach(() => {
    if (dataDir) rmSync(dataDir, { recursive: true, force: true });
    if (backupRoot) rmSync(backupRoot, { recursive: true, force: true });
  });

  it("data/ 를 타임스탬프 폴더로 복사한다", () => {
    dataDir = mkdtempSync(join(tmpdir(), "backup-data-"));
    backupRoot = mkdtempSync(join(tmpdir(), "backup-root-"));
    writeFileSync(join(dataDir, "accounts.json"), "[]");

    const result = backupData(dataDir, backupRoot, 30);

    expect(existsSync(join(result.target, "accounts.json"))).toBe(true);
    expect(readFileSync(join(result.target, "accounts.json"), "utf8")).toBe("[]");
  });

  it("data/ 가 없으면 에러를 던진다", () => {
    backupRoot = mkdtempSync(join(tmpdir(), "backup-root-"));
    expect(() => backupData(join(tmpdir(), "no-such-dir-xyz"), backupRoot)).toThrow("백업할 게 없습니다");
  });

  it("keep을 넘는 오래된 백업은 정리한다", () => {
    dataDir = mkdtempSync(join(tmpdir(), "backup-data-"));
    backupRoot = mkdtempSync(join(tmpdir(), "backup-root-"));
    writeFileSync(join(dataDir, "accounts.json"), "[]");

    backupData(dataDir, backupRoot, 2);
    backupData(dataDir, backupRoot, 2);
    const third = backupData(dataDir, backupRoot, 2);

    const remaining = readdirSync(backupRoot).filter((name) => /^\d{4}-\d{2}-\d{2}T/.test(name));
    expect(remaining).toHaveLength(2);
    expect(third.deleted).toBe(1);
    expect(third.kept).toBe(2);
  });
});
