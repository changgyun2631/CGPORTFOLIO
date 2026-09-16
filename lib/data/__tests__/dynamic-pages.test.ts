import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * 새 페이지를 추가하면서 `dynamic = "force-dynamic"`을 깜빡하기 쉽다 — 실제로
 * `backtests`/`dividends` 페이지가 그랬다(2026-09-16, WORK_ORDER P1-8). 이 페이지들은
 * `loadPortfolio` 등 cron이 갱신하는 시세·잔고에서 파생된 값을 쓰는데
 * `dynamic`이 없으면 Next.js가 정적으로 캐시할 수 있어, cron이 새 값을 써도
 * 재빌드 전까지 화면에 반영되지 않는다.
 *
 * `lib/data/views.ts`가 내보내는 함수 중 포트폴리오·시세 파생값을 다루는
 * 것들을 쓰는 `app/**\/page.tsx`는 전부 `dynamic = "force-dynamic"`을 내보내야
 * 한다는 걸 소스 텍스트 검사로 고정한다. 완벽한 파서는 아니지만(문자열
 * 매칭이라 주석 안의 함수명도 걸릴 수 있다), 이 프로젝트 규모에선 실수를
 * 잡는 데 충분하고 오탐이 나면 그때 봐도 된다.
 */

const here = dirname(fileURLToPath(import.meta.url));
const appDir = join(here, "..", "..", "..", "app");

const LIVE_DATA_LOADERS = [
  "loadPortfolio",
  "loadAccountSummary",
  "loadAssetMap",
  "loadDividendSummary",
  "loadRecentTrades",
  "loadChartTrades",
  "loadRecentCashFlows",
  "loadBacktests",
  "loadBacktest",
  "loadSymbolDetail",
  "loadSparklines",
  "loadPriceHistory",
];

function findPageFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) files.push(...findPageFiles(full));
    else if (entry === "page.tsx") files.push(full);
  }
  return files;
}

describe("실데이터(포트폴리오·시세)에 의존하는 페이지는 force-dynamic이어야 한다", () => {
  const pageFiles = findPageFiles(appDir);

  // 경로 계산이 틀어지면 아래 for 루프가 통째로 스킵돼 조용히 무의미한
  // "통과"가 나올 수 있다 — 스캔 자체가 실제로 페이지를 찾는지 먼저 확인한다.
  it("app/ 아래 page.tsx를 실제로 찾는다", () => {
    expect(pageFiles.length).toBeGreaterThan(5);
  });

  for (const file of pageFiles) {
    const source = readFileSync(file, "utf8");
    const usesLiveData = LIVE_DATA_LOADERS.some((fn) => new RegExp(`\\b${fn}\\b`).test(source));
    if (!usesLiveData) continue;

    const relative = file.slice(appDir.length + 1).replace(/\\/g, "/");
    it(`${relative} 는 dynamic = "force-dynamic"을 내보낸다`, () => {
      expect(source).toMatch(/export const dynamic\s*=\s*["']force-dynamic["']/);
    });
  }
});
