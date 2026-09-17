import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

// renameSync·unlinkSync를 실제 구현을 감싼 spy로 바꿔서, 테스트별로 한 번씩 실패를
// 주입할 수 있게 한다. node:fs는 ESM 네임스페이스라 vi.spyOn으로는 못 바꾸고 vi.mock이
// 필요하다.
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, renameSync: vi.fn(actual.renameSync), unlinkSync: vi.fn(actual.unlinkSync) };
});

const { withDataLock, writeJsonAtomic } = await import("../atomic-write.mjs");
const fsNode = await import("node:fs");

describe("writeJsonAtomic", () => {
  let dir;
  let consoleErrorSpy;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    vi.mocked(fsNode.renameSync).mockRestore?.();
    vi.mocked(fsNode.unlinkSync).mockRestore?.();
    consoleErrorSpy?.mockRestore();
  });

  it("파일이 없을 때 새로 쓴다", () => {
    dir = mkdtempSync(join(tmpdir(), "atomic-write-"));
    const target = join(dir, "data.json");
    writeJsonAtomic(target, '{"a":1}');
    expect(readFileSync(target, "utf8")).toBe('{"a":1}');
  });

  it("기존 파일이 있으면 .bak으로 남기고 새 내용으로 교체한다", () => {
    dir = mkdtempSync(join(tmpdir(), "atomic-write-"));
    const target = join(dir, "data.json");
    writeFileSync(target, "OLD");
    writeJsonAtomic(target, "NEW");
    expect(readFileSync(target, "utf8")).toBe("NEW");
    expect(readFileSync(`${target}.bak`, "utf8")).toBe("OLD");
  });

  it("rename 단계에서 실패를 주입해도 기존 파일은 그대로 읽힌다", () => {
    dir = mkdtempSync(join(tmpdir(), "atomic-write-"));
    const target = join(dir, "data.json");
    writeFileSync(target, "OLD");

    vi.mocked(fsNode.renameSync).mockImplementationOnce(() => {
      throw new Error("시뮬레이션된 디스크 오류");
    });

    expect(() => writeJsonAtomic(target, "NEW")).toThrow("시뮬레이션된 디스크 오류");
    expect(readFileSync(target, "utf8")).toBe("OLD");

    // 재시도하면(다음 호출은 실제 renameSync를 쓰므로) 정상적으로 교체된다.
    writeJsonAtomic(target, "NEW");
    expect(readFileSync(target, "utf8")).toBe("NEW");
  });

  it("rename이 실패해도 임시 파일을 남기지 않는다", () => {
    // 남은 임시 파일에는 대상과 같은 실제 계좌 데이터가 들어 있어서, 지우지 않으면
    // 저장소에 미추적 상태로 굴러다닌다(2026-09-17 실제로 한 건 발생).
    dir = mkdtempSync(join(tmpdir(), "atomic-write-"));
    const target = join(dir, "data.json");
    writeFileSync(target, "OLD");

    vi.mocked(fsNode.renameSync).mockImplementationOnce(() => {
      throw new Error("EPERM: operation not permitted, rename");
    });

    expect(() => writeJsonAtomic(target, "NEW")).toThrow("EPERM");
    expect(readdirSync(dir).filter((name) => name.includes(".tmp-"))).toEqual([]);
    expect(readFileSync(target, "utf8")).toBe("OLD");
  });

  it("정상 저장 뒤에도 임시 파일이 남지 않는다", () => {
    dir = mkdtempSync(join(tmpdir(), "atomic-write-"));
    const target = join(dir, "data.json");
    writeJsonAtomic(target, "NEW");
    expect(readdirSync(dir).filter((name) => name.includes(".tmp-"))).toEqual([]);
  });

  it("rename에 이어 unlink까지 실패해도 원래 rename 오류가 유지되고, 정리 실패가 진단으로 남는다", () => {
    // GPT 3차 검수 12-3: 정리 실패를 삼키기만 하면 임시 파일(=실제 계좌 데이터)이
    // 남아도 아무도 모른다. rename 오류는 그대로 던지되, 콘솔에 오류 코드·basename만
    // (경로·내용은 없이) 남기는지 확인한다.
    dir = mkdtempSync(join(tmpdir(), "atomic-write-"));
    const target = join(dir, "data.json");
    writeFileSync(target, "OLD");
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    vi.mocked(fsNode.renameSync).mockImplementationOnce(() => {
      const error = new Error("rename 실패");
      error.code = "EPERM";
      throw error;
    });
    vi.mocked(fsNode.unlinkSync).mockImplementationOnce(() => {
      const error = new Error("unlink 실패");
      error.code = "EBUSY";
      throw error;
    });

    expect(() => writeJsonAtomic(target, "NEW")).toThrow("rename 실패");
    expect(readFileSync(target, "utf8")).toBe("OLD"); // 대상 파일은 보존된다

    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    const logged = consoleErrorSpy.mock.calls[0][0];
    expect(logged).toContain("EBUSY");
    expect(logged).toMatch(/\.data\.json\.tmp-\d+-\d+/); // basename만
    expect(logged).not.toContain(dir); // 전체 경로는 남기지 않는다
    expect(logged).not.toContain("NEW"); // 파일 내용은 남기지 않는다
  });
});

describe("withDataLock", () => {
  let dir;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("잠금을 잡고 작업 후 풀어준다", () => {
    dir = mkdtempSync(join(tmpdir(), "atomic-lock-"));
    let ranInsideLock = false;
    withDataLock(dir, () => {
      ranInsideLock = true;
      expect(existsSync(join(dir, ".write.lock"))).toBe(true);
    });
    expect(ranInsideLock).toBe(true);
    expect(existsSync(join(dir, ".write.lock"))).toBe(false);
  });

  it("작업이 실패해도 잠금은 풀린다", () => {
    dir = mkdtempSync(join(tmpdir(), "atomic-lock-"));
    expect(() =>
      withDataLock(dir, () => {
        throw new Error("작업 실패");
      }),
    ).toThrow("작업 실패");
    expect(existsSync(join(dir, ".write.lock"))).toBe(false);
  });

  it("살아있는 프로세스가 잡은 잠금은 동시 실행으로 감지해 막는다", () => {
    dir = mkdtempSync(join(tmpdir(), "atomic-lock-"));
    // 현재 테스트 프로세스 자신의 pid로 "이미 잡혀 있는" 잠금을 흉내낸다 — 항상 살아있다.
    writeFileSync(
      join(dir, ".write.lock"),
      JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }),
    );
    let ran = false;
    expect(() => withDataLock(dir, () => { ran = true; })).toThrow(/잠금이 이미 걸려 있습니다/);
    expect(ran).toBe(false);
  });

  it("죽은 프로세스가 남긴 잠금은 정리하고 진행한다", () => {
    dir = mkdtempSync(join(tmpdir(), "atomic-lock-"));
    // 존재할 가능성이 거의 없는 pid로 "죽은 프로세스가 남긴" 잠금을 흉내낸다.
    writeFileSync(
      join(dir, ".write.lock"),
      JSON.stringify({ pid: 999999, startedAt: new Date().toISOString() }),
    );
    let ran = false;
    withDataLock(dir, () => { ran = true; });
    expect(ran).toBe(true);
    expect(existsSync(join(dir, ".write.lock"))).toBe(false);
  });
});
