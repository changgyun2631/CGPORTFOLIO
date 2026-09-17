"use server";

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { backupData } from "../../scripts/lib/backup.mjs";
import { normalizeLedger } from "../../scripts/lib/ledger-normalize.mjs";
import { validateCashFlows, validateTransactions } from "../../scripts/lib/validate.mjs";
import { requireAuthenticatedSession } from "../auth/guard";
import { withDataLock } from "../data/atomic-write";
import { GenerationWriteError, readOriginals, writeGenerationOrRollback } from "../data/generation-write";
import type { CashFlow, Transaction } from "../domain/types";
import { diffDataFiles, hashDataFiles } from "./data-version";
import { backupRoot, dataDir } from "./paths";
import type { ApplyResult } from "./position-basis-actions";
import { consumeStagedImport, pruneStaleStagedImports, stageImport } from "./staging";

const KIND = "normalize-ledger";

const BASELINE_FILES = ["transactions.json", "cashflows.json", "symbols.json"] as const;

export type NormalizeLedgerPreview = {
  token: string;
  transactionCount: number;
  cashflowCount: number;
  validationErrors: string[];
};

function readJson<T>(name: string): T {
  return JSON.parse(readFileSync(join(dataDir, name), "utf8")) as T;
}

/** 파일 업로드가 없다 — 기존 원장(transactions.json/cashflows.json)을 다시 정규화한다. */
export async function previewNormalizeLedger(): Promise<NormalizeLedgerPreview> {
  await requireAuthenticatedSession();
  pruneStaleStagedImports();

  // 입력 읽기 → 정규화 계산 → baseline 생성을 같은 잠금 스냅샷 안에서 한다 —
  // 이 사이(TOCTOU)에 다른 프로세스가 원장을 바꾸면 정규화 결과는 옛 데이터
  // 기준인데 baseline만 "바뀐 뒤" 값을 찍어, 적용 때 동시성 검사를 통과해
  // 버릴 수 있다(WORK_ORDER B-0A-2).
  const { normalizedTransactions, normalizedCashflows, validationErrors, baseline } = await withDataLock(dataDir, async () => {
    const transactions = readJson<Transaction[]>("transactions.json");
    const cashflows = readJson<CashFlow[]>("cashflows.json");
    const symbols = readJson<{ id: string; currency: string }[]>("symbols.json");

    const { transactions: normalizedTransactions, cashflows: normalizedCashflows } = normalizeLedger({
      transactions,
      cashflows,
      symbols,
    }) as { transactions: Transaction[]; cashflows: CashFlow[] };

    const accounts = readJson<{ id: string }[]>("accounts.json");
    const accountIds = new Set(accounts.map((a) => a.id));
    const symbolIds = new Set(symbols.map((s) => s.id));
    const validationErrors = [
      ...validateTransactions(normalizedTransactions, { accountIds, symbolIds }),
      ...validateCashFlows(normalizedCashflows, { accountIds }),
    ] as string[];

    return { normalizedTransactions, normalizedCashflows, validationErrors, baseline: hashDataFiles(dataDir, BASELINE_FILES) };
  });

  const token = stageImport(KIND, { transactions: normalizedTransactions, cashflows: normalizedCashflows, baseline });

  return {
    token,
    transactionCount: normalizedTransactions.length,
    cashflowCount: normalizedCashflows.length,
    validationErrors,
  };
}

export async function applyNormalizeLedger(token: string): Promise<ApplyResult> {
  await requireAuthenticatedSession();
  let staged: { transactions: Transaction[]; cashflows: CashFlow[]; baseline: Record<string, string> };
  try {
    staged = consumeStagedImport(KIND, token);
  } catch (error) {
    return { ok: false, errors: [(error as Error).message] };
  }

  try {
    return await withDataLock(dataDir, async () => {
      const changed = diffDataFiles(staged.baseline, hashDataFiles(dataDir, BASELINE_FILES));
      if (changed.length > 0) {
        return {
          ok: false,
          errors: [`미리보기 이후 데이터가 바뀌었습니다 (${changed.join(", ")}). 다시 미리보기한 뒤 적용해 주세요.`],
        };
      }

      const accounts = readJson<{ id: string }[]>("accounts.json");
      const symbols = readJson<{ id: string }[]>("symbols.json");
      const accountIds = new Set(accounts.map((a) => a.id));
      const symbolIds = new Set(symbols.map((s) => s.id));
      const validationErrors = [
        ...validateTransactions(staged.transactions, { accountIds, symbolIds }),
        ...validateCashFlows(staged.cashflows, { accountIds }),
      ] as string[];
      if (validationErrors.length > 0) return { ok: false, errors: validationErrors };

      const transactionsPath = join(dataDir, "transactions.json");
      const cashflowsPath = join(dataDir, "cashflows.json");
      const originals = readOriginals([transactionsPath, cashflowsPath]);

      backupData(dataDir, backupRoot);
      // transactions.json과 cashflows.json 둘을 한 세대로 묶어 쓴다 — 하나만
      // 쓰고 둘째에서 실패하면 두 파일이 서로 다른 세대로 섞일 수 있어서다
      // (cron의 quotes/fx/snapshots 묶음과 같은 이유, lib/data/generation-write.ts).
      writeGenerationOrRollback(
        [
          { path: transactionsPath, content: `${JSON.stringify(staged.transactions, null, 2)}\n` },
          { path: cashflowsPath, content: `${JSON.stringify(staged.cashflows, null, 2)}\n` },
        ],
        originals,
      );

      return { ok: true, message: `거래 ${staged.transactions.length}건과 현금흐름 ${staged.cashflows.length}건을 반영했습니다.` };
    });
  } catch (error) {
    if (error instanceof GenerationWriteError && !error.rollbackOk) {
      // 롤백 자체가 실패해 transactions.json/cashflows.json 상태가 불확실하다 —
      // "데이터는 안 바뀜"이라고 거짓 안내하지 않고, 자동 재시도(retryToken)도
      // 주지 않는다. 사람이 직접 확인하고 필요하면 최신 자동 백업에서 복원해야
      // 한다(WORK_ORDER B-0A-4).
      return {
        ok: false,
        errors: [
          `반영 중 오류가 발생했고, 되돌리기까지 실패했습니다: ${error.writeError.message}. ` +
            `data/transactions.json·cashflows.json 상태를 직접 확인하고, 필요하면 최신 자동 백업(npm run backup:verify)에서 복원하세요.`,
        ],
      };
    }
    const retryToken = stageImport(KIND, staged);
    return {
      ok: false,
      errors: [`반영 중 오류가 발생했습니다: ${(error as Error).message} (데이터는 바뀌지 않았습니다 — 다시 시도할 수 있습니다.)`],
      retryToken,
    };
  }
}
