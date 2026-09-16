"use server";

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { backupData } from "../../scripts/lib/backup.mjs";
import { decodeEucKr } from "../../scripts/lib/csv.mjs";
import { buildAccountHistorySnapshots, parseAccountHistoryTotals } from "../../scripts/lib/import-account-history.mjs";
import { validateSnapshots } from "../../scripts/lib/validate.mjs";
import { withDataLock, writeJsonAtomic } from "../data/atomic-write";
import type { Snapshot } from "../domain/types";
import { diffDataFiles, hashDataFiles } from "./data-version";
import { assertFileWithinLimits, assertRowCountWithinLimits } from "./limits";
import { backupRoot, dataDir } from "./paths";
import { consumeStagedImport, pruneStaleStagedImports, stageImport } from "./staging";
import type { ApplyResult } from "./position-basis-actions";

const KIND = "account-history";

// snapshots.json은 6시간마다 cron이 새 스냅샷을 추가한다 — 미리보기 때 만든 병합
// 결과를 그 사이 값이 바뀐 걸 모르고 통째로 덮어쓰면 cron이 쌓은 새 스냅샷을
// 잃는다. 그래서 적용 직전 이 파일들이 그대로인지 반드시 확인한다.
const BASELINE_FILES = ["fx.json", "snapshots.json", "cashflows.json"] as const;

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
  files.forEach((file, index) => assertFileWithinLimits(file, `계좌수익률 CSV #${index + 1}`));

  const decodedTexts = await Promise.all(files.map(async (file) => decodeEucKr(Buffer.from(await file.arrayBuffer()))));
  const totals = parseAccountHistoryTotals(decodedTexts);
  assertRowCountWithinLimits(totals.size, "계좌수익률 CSV 병합 결과");

  const fxHistory = readJson<{ d: string; rate: number }[]>("fx.json");
  const existingSnapshots = readJson<Snapshot[]>("snapshots.json");
  const existingCashflows = readJson<{ at: string; kind?: string; type: string; amount: number; currency: string }[]>(
    "cashflows.json",
  );
  const snapshots = buildAccountHistorySnapshots(totals, { fxHistory, existingSnapshots, existingCashflows }) as Snapshot[];

  const validationErrors = validateSnapshots(snapshots) as string[];
  const baseline = hashDataFiles(dataDir, BASELINE_FILES);
  const token = stageImport(KIND, { snapshots, baseline });

  return { token, fileCount: files.length, dayCount: totals.size, snapshotCount: snapshots.length, validationErrors };
}

export async function applyAccountHistory(token: string): Promise<ApplyResult> {
  let staged: { snapshots: Snapshot[]; baseline: Record<string, string> };
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

      const validationErrors = validateSnapshots(staged.snapshots) as string[];
      if (validationErrors.length > 0) return { ok: false, errors: validationErrors };

      backupData(dataDir, backupRoot);
      writeJsonAtomic(join(dataDir, "snapshots.json"), `${JSON.stringify(staged.snapshots, null, 2)}\n`);

      return { ok: true, message: `총 ${staged.snapshots.length}개 스냅샷을 반영했습니다.` };
    });
  } catch (error) {
    const retryToken = stageImport(KIND, staged);
    return {
      ok: false,
      errors: [`반영 중 오류가 발생했습니다: ${(error as Error).message} (데이터는 바뀌지 않았습니다 — 다시 시도할 수 있습니다.)`],
      retryToken,
    };
  }
}
