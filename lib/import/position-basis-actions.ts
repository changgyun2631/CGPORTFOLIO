"use server";

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { backupData } from "../../scripts/lib/backup.mjs";
import { withDataLock, writeJsonAtomic } from "../data/atomic-write";
import { decodeEucKr } from "../../scripts/lib/csv.mjs";
import { crossCheckPositionBasis } from "../../scripts/lib/cross-check.mjs";
import { parsePositionBasisCsv } from "../../scripts/lib/import-position-basis.mjs";
import { validateBasisNotRegressing, validatePositionBasis } from "../../scripts/lib/validate.mjs";
import type { PositionBasis } from "../domain/types";
import { backupRoot, dataDir } from "./paths";
import { consumeStagedImport, pruneStaleStagedImports, stageImport } from "./staging";

const KIND = "position-basis";

export type PositionBasisPreview = {
  token: string;
  count: number;
  accountId: string;
  validationErrors: string[];
  crossCheck: { exceeded: string[]; toleranceKrw: number; ok: boolean };
};

export type ApplyResult = { ok: true; message: string } | { ok: false; errors: string[] };

function readJson<T>(name: string): T {
  return JSON.parse(readFileSync(join(dataDir, name), "utf8")) as T;
}

/** 잔고 CSV를 읽어 미리보기만 만든다. 이 단계에서는 아무 파일도 바뀌지 않는다. */
export async function previewPositionBasis(formData: FormData): Promise<PositionBasisPreview> {
  pruneStaleStagedImports();

  const file = formData.get("file");
  const accountId = String(formData.get("accountId") ?? "").trim();
  if (!(file instanceof File)) throw new Error("보유종목 CSV 파일을 선택하세요.");
  if (!accountId) throw new Error("계좌 ID를 입력하세요.");

  const decoded = decodeEucKr(Buffer.from(await file.arrayBuffer()));
  const at = new Date(file.lastModified || Date.now()).toISOString();
  const { basis, crossCheckInput } = parsePositionBasisCsv(decoded, { accountId, at });

  const accounts = readJson<{ id: string }[]>("accounts.json");
  const symbols = readJson<{ id: string }[]>("symbols.json");
  const accountIds = new Set(accounts.map((a) => a.id));
  const symbolIds = new Set(symbols.map((s) => s.id));

  const transactions = readJson<{ at: string }[]>("transactions.json");
  const cashflows = readJson<{ at: string }[]>("cashflows.json");

  const validationErrors = [
    ...validatePositionBasis(basis, { accountIds, symbolIds }),
    ...validateBasisNotRegressing(basis, { transactions, cashflows }),
  ] as string[];
  const crossCheck = crossCheckPositionBasis(crossCheckInput) as { exceeded: string[]; toleranceKrw: number; ok: boolean };

  const token = stageImport(KIND, { basis, accountId });

  return { token, count: basis.length, accountId, validationErrors, crossCheck };
}

/** 미리보기 토큰으로 실제 반영한다. 적용 직전 자동 백업을 만들고, 검증을 한 번 더 거친다. */
export async function applyPositionBasis(token: string): Promise<ApplyResult> {
  let staged: { basis: PositionBasis[]; accountId: string };
  try {
    staged = consumeStagedImport(KIND, token);
  } catch (error) {
    return { ok: false, errors: [(error as Error).message] };
  }

  const accounts = readJson<{ id: string }[]>("accounts.json");
  const symbols = readJson<{ id: string }[]>("symbols.json");
  const accountIds = new Set(accounts.map((a) => a.id));
  const symbolIds = new Set(symbols.map((s) => s.id));
  const transactions = readJson<{ at: string }[]>("transactions.json");
  const cashflows = readJson<{ at: string }[]>("cashflows.json");

  const validationErrors = [
    ...validatePositionBasis(staged.basis, { accountIds, symbolIds }),
    ...validateBasisNotRegressing(staged.basis, { transactions, cashflows }),
  ] as string[];
  if (validationErrors.length > 0) return { ok: false, errors: validationErrors };

  backupData(dataDir, backupRoot);
  await withDataLock(dataDir, async () => {
    writeJsonAtomic(join(dataDir, "position-basis.json"), `${JSON.stringify(staged.basis, null, 2)}\n`);
  });

  return { ok: true, message: `현재 잔고 기준 ${staged.basis.length}종목을 반영했습니다.` };
}
