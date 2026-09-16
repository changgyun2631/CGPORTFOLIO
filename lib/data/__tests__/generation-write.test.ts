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
  return { ...actual, renameSync: vi.fn(actual.renameSync) };
});

const { readOriginals, writeGenerationOrRollback } = await import("../generation-write");
const fsNode = await import("node:fs");
const actual = await vi.importActual<typeof import("node:fs")>("node:fs");

describe("readOriginals / writeGenerationOrRollback", () => {
  let dir: string;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    vi.mocked(fsNode.renameSync).mockClear();
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
});
