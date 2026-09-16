"use server";

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { backupData } from "../../scripts/lib/backup.mjs";
import { decodeEucKr } from "../../scripts/lib/csv.mjs";
import { buildAccountHistorySnapshots, parseAccountHistoryTotals } from "../../scripts/lib/import-account-history.mjs";
import { validateSnapshots } from "../../scripts/lib/validate.mjs";
import { withDataLock, writeJsonAtomic } from "../data/atomic-write";
import type { Snapshot } from "../domain/types";
import { backupRoot, dataDir } from "./paths";
import { consumeStagedImport, pruneStaleStagedImports, stageImport } from "./staging";
import type { ApplyResult } from "./position-basis-actions";

const KIND = "account-history";

export type AccountHistoryPreview = {
  token: string;
  fileCount: number;
  dayCount: number;
  snapshotCount: number;
  validationErrors: string[];
};

function readJson<T>(name: string): T {
  return JSON.parse(readFileSync(join(dataDir, name), "utf8")) as T;
}

export async function previewAccountHistory(formData: FormData): Promise<AccountHistoryPreview> {
  pruneStaleStagedImports();

  const files = formData.getAll("files").filter((f): f is File => f instanceof File);
  if (files.length === 0) throw new Error("계좌수익률 CSV 파일을 선택하세요.");

  const decodedTexts = await Promise.all(files.map(async (file) => decodeEucKr(Buffer.from(await file.arrayBuffer()))));
  const totals = parseAccountHistoryTotals(decodedTexts);

  const fxHistory = readJson<{ d: string; rate: number }[]>("fx.json");
  const existingSnapshots = readJson<Snapshot[]>("snapshots.json");
  const existingCashflows = readJson<{ at: string; kind?: string; type: string; amount: number; currency: string }[]>(
    "cashflows.json",
  );
  const snapshots = buildAccountHistorySnapshots(totals, { fxHistory, existingSnapshots, existingCashflows }) as Snapshot[];

  const validationErrors = validateSnapshots(snapshots) as string[];
  const token = stageImport(KIND, { snapshots });

  return { token, fileCount: files.length, dayCount: totals.size, snapshotCount: snapshots.length, validationErrors };
}

export async function applyAccountHistory(token: string): Promise<ApplyResult> {
  let staged: { snapshots: Snapshot[] };
  try {
    staged = consumeStagedImport(KIND, token);
  } catch (error) {
    return { ok: false, errors: [(error as Error).message] };
  }

  const validationErrors = validateSnapshots(staged.snapshots) as string[];
  if (validationErrors.length > 0) return { ok: false, errors: validationErrors };

  backupData(dataDir, backupRoot);
  await withDataLock(dataDir, async () => {
    writeJsonAtomic(join(dataDir, "snapshots.json"), `${JSON.stringify(staged.snapshots, null, 2)}\n`);
  });

  return { ok: true, message: `총 ${staged.snapshots.length}개 스냅샷을 반영했습니다.` };
}
