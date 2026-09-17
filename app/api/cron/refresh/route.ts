import { join } from "node:path";

import { NextResponse } from "next/server";

import { authorizeCronRequest } from "@/lib/auth/cron";
import { withDataLock } from "@/lib/data/atomic-write";
import { logCronStage } from "@/lib/data/cron-log";
import { GenerationWriteError, readOriginals, writeGenerationOrRollback } from "@/lib/data/generation-write";
import { beginJob, failJob, finishJob, markStage, runningJob } from "@/lib/data/refresh-job";
import { getSymbols } from "@/lib/data/store";
import { loadRawUncached, makeFxLookup } from "@/lib/data/views";
import { buildPortfolio } from "@/lib/domain/portfolio";
import type { FxRate, Quote, Snapshot } from "@/lib/domain/types";
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

/**
 * 갱신을 접수만 하고 바로 `jobId`를 돌려준다. 실제 작업은 응답을 보낸 뒤 이
 * 프로세스 안에서 계속 돌고, 호출한 쪽은 `/api/cron/refresh/status`로 확인한다.
 * 긴 응답 하나를 기다리면 Undici `headersTimeout`(5분)에 걸려 성공한 갱신도
 * 실패로 보고되던 문제를 구조로 없앤 것이다(`lib/data/refresh-job.ts` 참고).
 */
export async function GET(request: Request) {
  if (!authorizeCronRequest(request)) {
    return NextResponse.json({ ok: false, error: "인증 실패" }, { status: 401 });
  }

  const running = runningJob();
  if (running) {
    logCronStage(`중복 호출 무시 — 이미 ${running.jobId} 진행 중(${running.stage})`);
    return NextResponse.json(
      { ok: false, error: "이미 갱신이 진행 중입니다.", code: "duplicate", jobId: running.jobId },
      { status: 409 },
    );
  }

  const job = beginJob();
  if (!job) {
    return NextResponse.json({ ok: false, error: "작업을 시작하지 못했습니다.", code: "duplicate" }, { status: 409 });
  }

  // 응답을 먼저 보내고 작업은 뒤에서 계속 돌린다.
  void runRefresh(job.jobId);
  return NextResponse.json({ ok: true, jobId: job.jobId, status: "running" }, { status: 202 });
}

async function runRefresh(jobId: string): Promise<void> {
  const startedAt = Date.now();
  logCronStage(`시작 — job ${jobId}`);

  try {
    // 느린 외부 호출(시세·환율 조회)은 전부 잠금 밖에서 끝낸다 — data/.write.lock을
    // 잡은 채로 네트워크 응답을 기다리면, 그동안 다른 가져오기 작업이 전부 막힌다.
    markStage(jobId, "종목 조회");
    const symbols = await getSymbols();
    const tQuotes = Date.now();
    const report = await fetchAllQuotes(symbols);
    logCronStage(
      `종목 조회 완료 — 성공 ${report.quotes.length}건, 누락 ${report.missing.length}건, 오류 ${report.errors.length}건, ${Date.now() - tQuotes}ms`,
    );

    if (report.quotes.length === 0) {
      logCronStage("중단 — 시세를 한 건도 받지 못함");
      failJob(jobId, {
        code: "provider",
        provider: report.errors[0]?.provider,
        message: "시세를 한 건도 받지 못해 저장하지 않았습니다.",
      });
      return;
    }

    let liveFx: FxRate | null = null;
    const fxProvider = buildFxProvider();
    if (fxProvider) {
      const tFx = Date.now();
      try {
        const fetched = await fxProvider.fetchRate("USD", "KRW");
        liveFx = { pair: "USD/KRW", ...fetched };
        logCronStage(`환율 조회 완료 — ${Date.now() - tFx}ms`);
      } catch (error) {
        report.errors.push({ provider: fxProvider.name, message: (error as Error).message });
        logCronStage(`환율 조회 실패 — ${(error as Error).message}, ${Date.now() - tFx}ms`);
      }
    }

    // quotes/fx/snapshots 세 파일을 한 세대로 묶어 쓴다: 셋 다 쓰기 전에 새 내용을
    // 전부 메모리에서 준비해 두고, 순서대로 원자적 교체한다. 그중 하나라도
    // 실패하면 이미 쓴 파일들을 실패 직전 원본 바이트로 되돌려, "일부는 새
    // 세대·일부는 이전 세대"로 섞인 채 남는 걸 막는다(개별 파일 자체가 일부만
    // 쓰이는 것은 writeJsonAtomic이 이미 막는다 — 이건 그 위에서 파일 "사이"의
    // 일관성을 보장하는 것이다).
    //
    // 총액 계산에 쓰는 계좌·잔고·시세 등은 잠금을 잡은 "지금" 다시 읽는다
    // (`loadRawUncached`, 캐시를 거치지 않는 직접 읽기) — 이 요청이 시작할 때
    // `getSymbols()`가 이미 React cache를 채워 뒀으므로, 같은 캐시를 쓰는
    // `loadPortfolio()`류 함수를 다시 불러 봐야 외부 API를 기다리는 동안
    // 다른 프로세스가 바꿔 놓았을 수 있는 최신 값이 아니라 요청 시작 시점의
    // 값을 그대로 돌려받는다(WORK_ORDER B-0A-3).
    markStage(jobId, "파일 세대 쓰기");
    const tWrite = Date.now();
    await withDataLock(dataDir, async () => {
      const quotesPath = join(dataDir, "quotes.json");
      const fxPath = join(dataDir, "fx-quote.json");
      const snapshotsPath = join(dataDir, "snapshots.json");
      const originals = readOriginals([quotesPath, fxPath, snapshotsPath]);

      const raw = await loadRawUncached();

      // 이번에 받지 못한 종목은 "지금" 저장돼 있는 값을 그대로 둔다(외부 조회
      // 시작 시점 값이 아니라, 잠금 잡은 시점 기준 최신 값 위에 얹는다).
      const merged = new Map(raw.quotes.map((quote) => [quote.symbolId, quote]));
      for (const quote of report.quotes) merged.set(quote.symbolId, quote);
      const mergedQuotes: Quote[] = [...merged.values()];

      const fx: FxRate = liveFx ?? raw.fx;

      const fxRateAt = makeFxLookup(raw.fxHistory, fx.rate);
      const portfolio = buildPortfolio({
        accounts: raw.accounts,
        symbols: raw.symbols,
        transactions: raw.transactions,
        cashflows: raw.cashflows,
        dividends: raw.dividends,
        positionBasis: raw.positionBasis,
        principalKrw: raw.snapshots.at(-1)?.principalKrw,
        quotes: mergedQuotes,
        fx,
        fxRateAt,
      });

      const point: Snapshot = {
        at: new Date().toISOString(),
        totalKrw: portfolio.totals.totalKrw,
        principalKrw: portfolio.totals.principalKrw,
        fxRate: fx.rate,
      };

      const writes = [
        { path: quotesPath, content: `${JSON.stringify(mergedQuotes, null, 2)}\n` },
        { path: fxPath, content: `${JSON.stringify(fx, null, 2)}\n` },
        { path: snapshotsPath, content: `${JSON.stringify([...raw.snapshots, point], null, 2)}\n` },
      ];
      writeGenerationOrRollback(writes, originals);
    });
    logCronStage(`파일 세대 쓰기 완료 — ${Date.now() - tWrite}ms`);
    logCronStage(`전체 완료 — job ${jobId}, ${Date.now() - startedAt}ms`);

    finishJob(jobId, {
      updated: report.quotes.length,
      missingCount: report.missing.length,
      errorCount: report.errors.length,
    });
  } catch (error) {
    if (error instanceof GenerationWriteError && !error.rollbackOk) {
      // 롤백 자체가 실패해 quotes/fx-quote/snapshots 상태가 불확실하다 — 그냥
      // "실패"로만 남기면 다음 담당자가 파일이 이전 세대 그대로라고 오해할 수
      // 있으니 로그에 명시적으로 남긴다(WORK_ORDER B-0A-4).
      logCronStage(
        `오류로 중단 + 롤백도 실패 — data/quotes.json·fx-quote.json·snapshots.json 상태가 불확실합니다. 직접 확인 필요: ${error.writeError.message}`,
      );
      failJob(jobId, { code: "write", message: `${error.message} (롤백 실패)` });
      return;
    }
    logCronStage(`오류로 중단 — job ${jobId}, ${(error as Error).message}`);
    failJob(jobId, { code: "unknown", message: (error as Error).message });
  }
}
