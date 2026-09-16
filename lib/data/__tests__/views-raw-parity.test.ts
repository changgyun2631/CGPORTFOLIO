import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * `loadRawUncached()`가 `loadRaw()`와 같은 파일 집합을 읽는지 확인한다.
 *
 * 원래는 두 함수를 직접 불러 비교하고 싶었지만, `views.ts`는 다른 도메인 모듈을
 * "@/lib/..." alias로 값 import하는데 이 저장소의 `vitest.config.mts`에는 별칭
 * 해석이 구성돼 있지 않다(다른 모든 테스트가 상대 경로만 쓰는 이유이기도 하다 —
 * `vite-tsconfig-paths` 같은 플러그인이 없다). 그래서 런타임에 모듈을 불러 비교하는
 * 대신 소스 텍스트에서 두 함수가 구조분해하는 필드 이름 목록(`const [accounts,
 * symbols, ...] = await Promise.all([...])`)과 반환 객체 모양을 비교한다 —
 * `loadRaw`는 이름 있는 getter(`getAccounts()`)를, `loadRawUncached`는
 * `readJsonUncached("accounts.json")`을 직접 부르는 식으로 호출 형태 자체는
 * 다르지만, 결과로 묶는 필드 이름·순서는 항상 같아야 한다. 하나라도
 * 깜빡하고 안 맞추면(필드 추가 등) 이 테스트가 실패한다.
 */
describe("loadRaw / loadRawUncached 필드 정합성", () => {
  it("두 함수가 정확히 같은 필드를 같은 순서로 구조분해·반환한다", () => {
    const source = readFileSync(join(process.cwd(), "lib/data/views.ts"), "utf8");

    const extractFieldLists = (label: string) => {
      const pattern = new RegExp(`${label}[\\s\\S]*?const \\[([^\\]]+)\\][\\s\\S]*?return \\{ ([^}]+) \\};`);
      const match = source.match(pattern);
      expect(match, `${label} 근처에서 필드 목록을 못 찾았다 — 정규식이 코드 구조 변경을 못 따라갔을 수 있다`).toBeTruthy();
      const destructured = match![1].split(",").map((s) => s.trim());
      const returned = match![2].split(",").map((s) => s.trim());
      return { destructured, returned };
    };

    const cached = extractFieldLists("loadRaw = cache");
    const uncached = extractFieldLists("loadRawUncached");

    expect(cached.destructured.length).toBeGreaterThan(5); // 정규식이 헛돌며 통과하는 사고를 막는 최소 방어선
    expect(uncached.destructured).toEqual(cached.destructured);
    expect(uncached.returned).toEqual(cached.returned);
  });
});
