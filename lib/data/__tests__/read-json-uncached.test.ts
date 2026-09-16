import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// store.ts는 `const dataDir = join(process.cwd(), "data")`를 모듈 로드 시점에
// 한 번만 계산한다 — process.cwd()를 먼저 바꿔 둔 뒤 모듈을 동적으로 import해야
// 테스트용 임시 폴더를 가리키게 할 수 있다. store.ts 자체는 "@/..." alias로 값을
// import하지 않으므로(타입만) 이 파일은 cwd를 안전하게 모킹할 수 있다 — alias
// 해석이 필요한 `loadRawUncached`는 별도 파일(`views-raw-parity.test.ts`)에서
// cwd를 건드리지 않고 검증한다(같이 두면 vitest 모듈 리졸버가 뒤섞인다).
let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "store-uncached-"));
  mkdirSync(join(root, "data"));
  vi.spyOn(process, "cwd").mockReturnValue(root);
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(root, { recursive: true, force: true });
});

describe("readJsonUncached", () => {
  it("캐시를 거치지 않고 매번 지금 파일 내용을 읽는다", async () => {
    const { readJsonUncached } = await import("../store");
    const target = join(root, "data", "quotes.json");
    writeFileSync(target, JSON.stringify([{ symbolId: "QLD", price: 1 }]));

    const first = await readJsonUncached<{ symbolId: string; price: number }[]>("quotes.json");
    expect(first[0].price).toBe(1);

    writeFileSync(target, JSON.stringify([{ symbolId: "QLD", price: 2 }]));
    const second = await readJsonUncached<{ symbolId: string; price: number }[]>("quotes.json");
    expect(second[0].price).toBe(2); // 캐시됐다면 여전히 1이었을 것
  });

  it("파일이 없으면 seed 안내가 포함된 오류를 던진다", async () => {
    const { readJsonUncached } = await import("../store");
    await expect(readJsonUncached("missing.json")).rejects.toThrow("scripts/seed.mjs");
  });
});
