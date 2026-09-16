import { readdirSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { consumeStagedImport, pruneStaleStagedImports, stageImport } = await import("../staging");

describe("staging", () => {
  it("저장한 값을 같은 kind·토큰으로 한 번 읽을 수 있다", () => {
    const token = stageImport("test-kind", { hello: "world" });
    const value = consumeStagedImport<{ hello: string }>("test-kind", token);
    expect(value).toEqual({ hello: "world" });
  });

  it("한 번 읽으면 같은 토큰으로 다시 못 읽는다", () => {
    const token = stageImport("test-kind", { n: 1 });
    consumeStagedImport("test-kind", token);
    expect(() => consumeStagedImport("test-kind", token)).toThrow();
  });

  it("kind가 다르면 거부한다", () => {
    const token = stageImport("kind-a", { n: 1 });
    expect(() => consumeStagedImport("kind-b", token)).toThrow("종류가 일치하지 않습니다");
  });

  it("존재하지 않는 토큰은 거부한다", () => {
    expect(() => consumeStagedImport("test-kind", "00000000-0000-0000-0000-000000000000")).toThrow(
      "찾을 수 없습니다",
    );
  });

  it("형식이 이상한 토큰(경로 조작 시도 등)은 거부한다", () => {
    expect(() => consumeStagedImport("test-kind", "../../etc/passwd")).toThrow("올바르지 않습니다");
  });

  it("30분이 지난 토큰은 consumeStagedImport가 만료로 거부한다", () => {
    vi.useFakeTimers();
    try {
      const token = stageImport("test-kind", { n: 1 });
      vi.advanceTimersByTime(31 * 60 * 1000);
      expect(() => consumeStagedImport("test-kind", token)).toThrow("만료");
    } finally {
      vi.useRealTimers();
    }
  });

  it("pruneStaleStagedImports는 오래된 임시 파일(mtime 기준)을 정리한다", () => {
    const token = stageImport("test-kind", { n: 1 });
    const stagingDir = join(tmpdir(), "cgportfolio-import-staging");
    const path = join(stagingDir, `${token}.json`);
    const old = new Date(Date.now() - 31 * 60 * 1000);
    utimesSync(path, old, old);

    pruneStaleStagedImports();

    expect(readdirSync(stagingDir).includes(`${token}.json`)).toBe(false);
  });
});
