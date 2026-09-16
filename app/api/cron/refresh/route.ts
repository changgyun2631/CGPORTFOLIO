import { join } from "node:path";

import { NextResponse } from "next/server";

import { withDataLock } from "@/lib/data/atomic-write";
import { readOriginals, writeGenerationOrRollback } from "@/lib/data/generation-write";
import { getFxQuote, getSnapshots, getSymbols } from "@/lib/data/store";
import { loadPortfolio } from "@/lib/data/views";
import type { FxRate, Snapshot } from "@/lib/domain/types";
import { buildFxProvider, fetchAllQuotes } from "@/lib/providers";

/**
 * 시세 갱신 진입점.
 *
 *   시세 공급자 → data/quotes.json, data/fx-quote.json → 화면은 이 파일만 읽는다
 *
 * 화면을 열 때마다 외부 API를 부르지 않기 때문에, 방문자가 늘어도 호출 수는
 * 늘지 않는다. 무료 플랜을 쓰면서도 한도를 넘지 않는 이유가 이것이다.
 *
 * 호출 방법
 *   - 로컬/VPS: cron 이나 작업 스케줄러가 이 주소를 주기적으로 친다
 *   - 인증: CRON_SECRET 을 설정하면 Authorization: Bearer <secret> 를 요구한다
 *
 * 주의: 파일에 쓰기 때문에 읽기 전용 파일시스템(서버리스 환경)에서는 동작하지
 * 않는다. 그런 환경에 올릴 때는 이 핸들러의 저장 대상을 데이터베이스로 바꿔야
 * 한다. 읽는 쪽(lib/data/store.ts)도 함께 바꾸면 나머지 코드는 그대로다.
 */

export const dynamic = "force-dynamic";

const dataDir = join(process.cwd(), "data");

function authorize(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true; // 비워두면 로컬 개발용으로 열어 둔다.
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(request: Request) {
  if (!authorize(request)) {
    return NextResponse.json({ ok: false, error: "인증 실패" }, { status: 401 });
  }

  const startedAt = Date.now();

  try {
    const symbols = await getSymbols();
    const report = await fetchAllQuotes(symbols);

    if (report.quotes.length === 0) {
      return NextResponse.json(
        { ok: false, error: "시세를 한 건도 받지 못해 저장하지 않았습니다.", missing: report.missing, errors: report.errors },
        { status: 502 },
      );
    }

    // 이번에 받지 못한 종목은 기존 값을 그대로 둔다. 빈 값으로 덮어쓰지 않는다.
    const previous = await loadPortfolio();
    const merged = new Map(previous.quotes.map((quote) => [quote.symbolId, quote]));
    for (const quote of report.quotes) merged.set(quote.symbolId, quote);
    const mergedQuotes = [...merged.values()];

    let fx: FxRate = await getFxQuote();

    // quotes/fx/snapshots 세 파일을 한 세대로 묶어 쓴다: 셋 다 쓰기 전에 새 내용을
    // 전부 메모리에서 준비해 두고(recomputeTotal이 디스크 대신 이 값들을 그대로
    // 쓴다), 순서대로 원자적 교체한다. 그중 하나라도 실패하면 이미 쓴 파일들을
    // 실패 직전 원본 바이트로 되돌려, "일부는 새 세대·일부는 이전 세대"로 섞인
    // 채 남는 걸 막는다(개별 파일 자체가 일부만 쓰이는 것은 writeJsonAtomic이
    // 이미 막는다 — 이건 그 위에서 파일 "사이"의 일관성을 보장하는 것이다).
    const { totalKrw } = await withDataLock(dataDir, async () => {
      const quotesPath = join(dataDir, "quotes.json");
      const fxPath = join(dataDir, "fx-quote.json");
      const snapshotsPath = join(dataDir, "snapshots.json");
      const originals = readOriginals([quotesPath, fxPath, snapshotsPath]);

      const fxProvider = buildFxProvider();
      if (fxProvider) {
        try {
          const fetched = await fxProvider.fetchRate("USD", "KRW");
          fx = { pair: "USD/KRW", ...fetched };
        } catch (error) {
          report.errors.push({ provider: fxProvider.name, message: (error as Error).message });
        }
      }

      // 갱신된 시세로 평가금액을 다시 계산해 스냅샷 한 점을 만든다. 아직 아무
      // 파일도 쓰지 않은 상태의 메모리 값으로 계산한다.
      const snapshots = await getSnapshots();
      const refreshed = await recomputeTotal(previous, mergedQuotes, fx);
      const point: Snapshot = {
        at: new Date().toISOString(),
        totalKrw: refreshed.totalKrw,
        principalKrw: refreshed.principalKrw,
        fxRate: fx.rate,
      };

      const writes = [
        { path: quotesPath, content: `${JSON.stringify(mergedQuotes, null, 2)}\n` },
        { path: fxPath, content: `${JSON.stringify(fx, null, 2)}\n` },
        { path: snapshotsPath, content: `${JSON.stringify([...snapshots, point], null, 2)}\n` },
      ];
      writeGenerationOrRollback(writes, originals);

      return refreshed;
    });

    return NextResponse.json({
      ok: true,
      updated: report.quotes.length,
      missing: report.missing,
      errors: report.errors,
      totalKrw,
      fxRate: fx.rate,
      elapsedMs: Date.now() - startedAt,
    });
  } catch (error) {
    return NextResponse.json({ ok: false, error: (error as Error).message }, { status: 500 });
  }
}

/**
 * 아직 쓰지 않은 메모리 상의 시세·환율 값으로 평가금액을 계산한다. 예전에는
 * 파일을 쓴 뒤 다시 읽어 계산했지만, 세대 묶음 쓰기에서는 쓰기 전에 최종 값을
 * 전부 준비해 둬야 해서 인자로 직접 받는다.
 */
async function recomputeTotal(
  portfolio: Awaited<ReturnType<typeof loadPortfolio>>,
  quotes: { symbolId: string; price: number; currency: "KRW" | "USD" }[],
  fx: FxRate,
): Promise<{ totalKrw: number; principalKrw: number }> {
  const priceById = new Map(quotes.map((q) => [q.symbolId, q]));

  let total = 0;
  for (const holding of portfolio.holdings) {
    if (holding.kind === "cash") {
      total += holding.currency === "USD" ? holding.shares * fx.rate : holding.shares;
      continue;
    }
    const quote = priceById.get(holding.symbolId);
    const unit = quote?.price ?? holding.price;
    total += holding.shares * unit * (holding.currency === "USD" ? fx.rate : 1);
  }
  return { totalKrw: Math.round(total), principalKrw: portfolio.totals.principalKrw };
}
