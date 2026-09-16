import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// writeJsonAtomic의 마지막 단계인 renameSync만 spy로 바꿔서, 원하는 회차에 실패를
// 주입한다. node:fs는 ESM 네임스페이스라 vi.spyOn 대신 vi.mock이 필요하다
// (scripts/lib/__tests__/atomic-write.test.mjs와 같은 패턴). 기본 구현은
// 실제 renameSync 그대로라 mockImplementationOnce를 걸지 않은 호출은 정상 동작한다.
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, renameSync: vi.fn(actual.renameSync), readFileSync: vi.fn(actual.readFileSync) };
});

const { readOriginals, writeGenerationOrRollback, GenerationWriteError } = await import("../generation-write");
const fsNode = await import("node:fs");
const actual = await vi.importActual<typeof import("node:fs")>("node:fs");

describe("readOriginals / writeGenerationOrRollback", () => {
  let dir: string;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    vi.mocked(fsNode.renameSync).mockClear();
    vi.mocked(fsNode.readFileSync).mockClear();
  });

  it("전부 성공하면 파일 모두 새 내용으로 교체된다", () => {
    dir = mkdtempSync(join(tmpdir(), "generation-write-"));
    const a = join(dir, "a.json");
    const b = join(dir, "b.json");
    writeFileSync(a, "OLD_A");
    writeFileSync(b, "OLD_B");

    const originals = readOriginals([a, b]);
    writeGenerationOrRollback(
      [
        { path: a, content: "NEW_A" },
        { path: b, content: "NEW_B" },
      ],
      originals,
    );

    expect(readFileSync(a, "utf8")).toBe("NEW_A");
    expect(readFileSync(b, "utf8")).toBe("NEW_B");
  });

  it("두 번째 쓰기가 실패하면 이미 쓴 첫 번째 파일이 원본으로 되돌아가고, 세 번째는 아예 시도되지 않는다", () => {
    dir = mkdtempSync(join(tmpdir(), "generation-write-"));
    const a = join(dir, "a.json");
    const b = join(dir, "b.json");
    const c = join(dir, "c.json");
    writeFileSync(a, "OLD_A");
    writeFileSync(b, "OLD_B");
    writeFileSync(c, "OLD_C");

    const originals = readOriginals([a, b, c]);

    // 1번째(a) 호출은 정상 통과시키고, 2번째(b) 호출에만 실패를 주입한다.
    let call = 0;
    vi.mocked(fsNode.renameSync).mockImplementation((...args: Parameters<typeof fsNode.renameSync>) => {
      call += 1;
      if (call === 2) throw new Error("시뮬레이션된 디스크 오류");
      return actual.renameSync(...args);
    });

    expect(() =>
      writeGenerationOrRollback(
        [
          { path: a, content: "NEW_A" },
          { path: b, content: "NEW_B" },
          { path: c, content: "NEW_C" },
        ],
        originals,
      ),
    ).toThrow("시뮬레이션된 디스크 오류");

    expect(readFileSync(a, "utf8")).toBe("OLD_A"); // 쓰였다가 롤백됨
    expect(readFileSync(b, "utf8")).toBe("OLD_B"); // 실패한 그 쓰기 — 애초에 안 바뀜
    expect(readFileSync(c, "utf8")).toBe("OLD_C"); // 시도조차 안 됨
  });

  it("원본이 없던(새로 생기는) 파일이 롤백 대상이면 지운다", () => {
    dir = mkdtempSync(join(tmpdir(), "generation-write-"));
    const brandNew = join(dir, "brand-new.json");
    const existing = join(dir, "existing.json");
    writeFileSync(existing, "OLD");

    const originals = readOriginals([brandNew, existing]);
    expect(originals.get(brandNew)).toBeNull();

    let call = 0;
    vi.mocked(fsNode.renameSync).mockImplementation((...args: Parameters<typeof fsNode.renameSync>) => {
      call += 1;
      if (call === 2) throw new Error("두 번째 파일 쓰기 실패");
      return actual.renameSync(...args);
    });

    expect(() =>
      writeGenerationOrRollback(
        [
          { path: brandNew, content: "NEW" },
          { path: existing, content: "NEW" },
        ],
        originals,
      ),
    ).toThrow("두 번째 파일 쓰기 실패");

    expect(existsSync(brandNew)).toBe(false); // 원본이 없었으니 롤백은 "삭제"
    expect(readFileSync(existing, "utf8")).toBe("OLD");
  });

  it("새 파일 하나만 성공적으로 쓰는 경로에서는 원본을 건드리지 않는다", () => {
    dir = mkdtempSync(join(tmpdir(), "generation-write-"));
    const a = join(dir, "a.json");
    const originals = readOriginals([a]);
    expect(originals.get(a)).toBeNull();

    writeGenerationOrRollback([{ path: a, content: "NEW" }], originals);
    expect(readFileSync(a, "utf8")).toBe("NEW");
  });

  it("readOriginals: 파일이 없어서(ENOENT)가 아니라 못 읽은 것(예: 권한 오류)이면 삼키지 않고 던진다", () => {
    dir = mkdtempSync(join(tmpdir(), "generation-write-"));
    const a = join(dir, "a.json");
    writeFileSync(a, "OLD");

    vi.mocked(fsNode.readFileSync).mockImplementationOnce(() => {
      const error = new Error("권한이 없습니다") as NodeJS.ErrnoException;
      error.code = "EACCES";
      throw error;
    });

    expect(() => readOriginals([a])).toThrow("권한이 없습니다");
  });

  it("두 번째 쓰기 실패에 이어 롤백 쓰기까지 실패하면, 두 오류를 모두 담은 GenerationWriteError를 던지고 rollbackOk는 false다", () => {
    dir = mkdtempSync(join(tmpdir(), "generation-write-"));
    const a = join(dir, "a.json");
    const b = join(dir, "b.json");
    writeFileSync(a, "OLD_A");
    writeFileSync(b, "OLD_B");

    const originals = readOriginals([a, b]);

    // 1번째(a) 쓰기는 정상 통과, 2번째(b) 쓰기는 실패 → a를 롤백하려는 3번째
    // renameSync 호출도 실패시켜 "롤백 자체가 실패하는" 상황을 재현한다.
    let call = 0;
    vi.mocked(fsNode.renameSync).mockImplementation((...args: Parameters<typeof fsNode.renameSync>) => {
      call += 1;
      if (call === 2) throw new Error("두 번째 파일 쓰기 실패");
      if (call === 3) throw new Error("롤백 쓰기도 실패");
      return actual.renameSync(...args);
    });

    let thrown: unknown;
    try {
      writeGenerationOrRollback(
        [
          { path: a, content: "NEW_A" },
          { path: b, content: "NEW_B" },
        ],
        originals,
      );
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(GenerationWriteError);
    const error = thrown as InstanceType<typeof GenerationWriteError>;
    expect(error.rollbackOk).toBe(false);
    expect(error.writeError.message).toBe("두 번째 파일 쓰기 실패");
    expect(error.rollbackErrors).toHaveLength(1);
    expect(error.rollbackErrors[0].path).toBe(a);
    expect(error.rollbackErrors[0].error.message).toBe("롤백 쓰기도 실패");
    // a는 롤백이 실패했으니 쓰인 새 값 그대로 남아 있다 — "안 바뀌었다"고 자동으로 믿으면 안 되는 이유다.
    expect(readFileSync(a, "utf8")).toBe("NEW_A");
  });
});
