"use server";

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { backupData } from "../../scripts/lib/backup.mjs";
import { normalizeLedger } from "../../scripts/lib/ledger-normalize.mjs";
import { validateCashFlows, validateTransactions } from "../../scripts/lib/validate.mjs";
import { withDataLock, writeJsonAtomic } from "../data/atomic-write";
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
  pruneStaleStagedImports();

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

  const baseline = hashDataFiles(dataDir, BASELINE_FILES);
  const token = stageImport(KIND, { transactions: normalizedTransactions, cashflows: normalizedCashflows, baseline });

  return {
    token,
    transactionCount: normalizedTransactions.length,
    cashflowCount: normalizedCashflows.length,
    validationErrors,
  };
}

export async function applyNormalizeLedger(token: string): Promise<ApplyResult> {
  let staged: { transactions: Transaction[]; cashflows: CashFlow[]; baseline: Record<string, string> };
  try {
    staged = consumeStagedImport(KIND, token);
  } catch (error) {
    return { ok: false, errors: [(error as Error).message] };
  }

  return withDataLock(dataDir, async () => {
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

    backupData(dataDir, backupRoot);
    writeJsonAtomic(join(dataDir, "transactions.json"), `${JSON.stringify(staged.transactions, null, 2)}\n`);
    writeJsonAtomic(join(dataDir, "cashflows.json"), `${JSON.stringify(staged.cashflows, null, 2)}\n`);

    return { ok: true, message: `거래 ${staged.transactions.length}건과 현금흐름 ${staged.cashflows.length}건을 반영했습니다.` };
  });
}
