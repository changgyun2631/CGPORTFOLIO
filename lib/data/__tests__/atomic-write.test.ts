import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// renameSync·unlinkSync를 실제 구현을 감싼 spy로 바꿔서, 테스트별로 한 번씩 실패를
// 주입할 수 있게 한다. node:fs는 ESM 네임스페이스라 vi.spyOn으로는 못 바꾸고 vi.mock이
// 필요하다. scripts/lib/__tests__/atomic-write.test.mjs와 같은 패턴 — 서버용(이 파일)과
// 스크립트용 구현이 같은 동작을 하는지 각각 검증한다.
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, renameSync: vi.fn(actual.renameSync), unlinkSync: vi.fn(actual.unlinkSync) };
});

const { writeJsonAtomic } = await import("../atomic-write");
const fsNode = await import("node:fs");

describe("writeJsonAtomic (server)", () => {
  let dir: string;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn> | undefined;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    vi.mocked(fsNode.renameSync).mockRestore();
    vi.mocked(fsNode.unlinkSync).mockRestore();
    consoleErrorSpy?.mockRestore();
  });

  it("파일이 없을 때 새로 쓴다", () => {
    dir = mkdtempSync(join(tmpdir(), "atomic-write-ts-"));
    const target = join(dir, "data.json");
    writeJsonAtomic(target, '{"a":1}');
    expect(readFileSync(target, "utf8")).toBe('{"a":1}');
  });

  it("정상 저장 뒤에는 임시 파일이 남지 않는다", () => {
    dir = mkdtempSync(join(tmpdir(), "atomic-write-ts-"));
    const target = join(dir, "data.json");
    writeJsonAtomic(target, "NEW");
    expect(readdirSync(dir).filter((name) => name.includes(".tmp-"))).toEqual([]);
  });

  it("rename 실패만으로도 임시 파일을 지운다", () => {
    dir = mkdtempSync(join(tmpdir(), "atomic-write-ts-"));
    const target = join(dir, "data.json");
    writeFileSync(target, "OLD");

    vi.mocked(fsNode.renameSync).mockImplementationOnce(() => {
      throw new Error("시뮬레이션된 디스크 오류");
    });

    expect(() => writeJsonAtomic(target, "NEW")).toThrow("시뮬레이션된 디스크 오류");
    expect(readFileSync(target, "utf8")).toBe("OLD");
    expect(readdirSync(dir).filter((name) => name.includes(".tmp-"))).toEqual([]);
  });

  it("rename에 이어 unlink까지 실패해도 원래 rename 오류가 유지되고, 정리 실패가 진단으로 남는다", () => {
    // GPT 3차 검수 12-3. 정리 실패를 완전히 삼키면 임시 파일(=실제 계좌 데이터)이
    // 남아도 아무도 모른다. 원래 오류는 그대로 던지고, 콘솔에는 오류 코드와
    // basename만(전체 경로·파일 내용은 없이) 남기는지 확인한다.
    dir = mkdtempSync(join(tmpdir(), "atomic-write-ts-"));
    const target = join(dir, "data.json");
    writeFileSync(target, "OLD");
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    vi.mocked(fsNode.renameSync).mockImplementationOnce(() => {
      const error = new Error("rename 실패") as NodeJS.ErrnoException;
      error.code = "EPERM";
      throw error;
    });
    vi.mocked(fsNode.unlinkSync).mockImplementationOnce(() => {
      const error = new Error("unlink 실패") as NodeJS.ErrnoException;
      error.code = "EBUSY";
      throw error;
    });

    expect(() => writeJsonAtomic(target, "NEW")).toThrow("rename 실패");
    expect(readFileSync(target, "utf8")).toBe("OLD");

    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    const logged = consoleErrorSpy.mock.calls[0][0] as string;
    expect(logged).toContain("EBUSY");
    expect(logged).toMatch(/\.data\.json\.tmp-\d+-\d+/);
    expect(logged).not.toContain(dir);
    expect(logged).not.toContain("NEW");
  });
});
