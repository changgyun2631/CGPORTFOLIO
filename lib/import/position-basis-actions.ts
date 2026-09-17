"use server";

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { backupData } from "../../scripts/lib/backup.mjs";
import { withDataLock, writeJsonAtomic } from "../data/atomic-write";
import { decodeBrokerCsv } from "../../scripts/lib/csv.mjs";
import { crossCheckPositionBasis } from "../../scripts/lib/cross-check.mjs";
import { parsePositionBasisCsv } from "../../scripts/lib/import-position-basis.mjs";
import { validateBasisNotRegressing, validatePositionBasis } from "../../scripts/lib/validate.mjs";
import { requireAuthenticatedSession } from "../auth/guard";
import type { PositionBasis } from "../domain/types";
import { diffDataFiles, hashDataFiles } from "./data-version";
import { assertFileWithinLimits, assertRowCountWithinLimits } from "./limits";
import { backupRoot, dataDir } from "./paths";
import { consumeStagedImport, pruneStaleStagedImports, stageImport } from "./staging";

const KIND = "position-basis";

// 검증에 쓰는 파일들 + 실제 교체 대상(position-basis.json) — 미리보기 이후
// 이 중 하나라도 바뀌면 적용을 거부한다. 대상 파일이 빠져 있으면, 같은
// baseline에서 미리보기 두 개를 만들고 순서대로 적용했을 때 둘 다 "안 바뀜"으로
// 통과해 두 번째가 첫 번째를 조용히 덮어쓸 수 있다(WORK_ORDER B-0A-2).
const BASELINE_FILES = ["accounts.json", "symbols.json", "transactions.json", "cashflows.json", "position-basis.json"] as const;

export type PositionBasisPreview = {
  token: string;
  count: number;
  accountId: string;
  validationErrors: string[];
  crossCheck: { exceeded: string[]; toleranceKrw: number; ok: boolean };
};

export type ApplyResult =
  | { ok: true; message: string }
  // retryToken: 반영 직전(백업·잠금·쓰기) 예기치 못한 오류가 났을 때만 붙는다. 이
  // 시점에는 아무 파일도 바뀌지 않았다는 게 보장되므로, staged 데이터를 다시
  // 스테이징해 재업로드·재파싱 없이 같은 내용으로 한 번 더 적용을 시도할 수 있게
  // 한다. 검증 실패나 동시성 충돌처럼 "데이터 자체가 문제"인 경우는 다시 시도해도
  // 똑같이 실패하므로 retryToken을 주지 않는다 — 다시 미리보기하라고 안내한다.
  | { ok: false; errors: string[]; retryToken?: string };

function readJson<T>(name: string): T {
  return JSON.parse(readFileSync(join(dataDir, name), "utf8")) as T;
}

/** 잔고 CSV를 읽어 미리보기만 만든다. 이 단계에서는 아무 파일도 바뀌지 않는다. */
export async function previewPositionBasis(formData: FormData): Promise<PositionBasisPreview> {
  await requireAuthenticatedSession();
  pruneStaleStagedImports();

  const file = formData.get("file");
  const accountId = String(formData.get("accountId") ?? "").trim();
  if (!(file instanceof File)) throw new Error("보유종목 CSV 파일을 선택하세요.");
  if (!accountId) throw new Error("계좌 ID를 입력하세요.");
  assertFileWithinLimits(file, "보유종목 CSV");

  const decoded = decodeBrokerCsv(Buffer.from(await file.arrayBuffer()));
  const at = new Date(file.lastModified || Date.now()).toISOString();
  const { basis, crossCheckInput } = parsePositionBasisCsv(decoded, { accountId, at });
  assertRowCountWithinLimits(basis.length, "보유종목 CSV");
  const crossCheck = crossCheckPositionBasis(crossCheckInput) as { exceeded: string[]; toleranceKrw: number; ok: boolean };

  // 입력 읽기 → 검증 → baseline 생성을 같은 잠금 스냅샷 안에서 한다. 잠금 밖에서
  // 따로따로 하면 그 사이(TOCTOU) 다른 프로세스가 관련 파일을 바꿔도, baseline은
  // "바뀐 뒤" 값을 찍어 버려 정작 검증은 "바뀌기 전" 데이터로 한 상태가 될 수
  // 있다(WORK_ORDER B-0A-2). CSV decode/parse는 업로드 파일 자체에 대한 계산이라
  // data/와 무관해 잠금 밖에서 미리 끝낸다 — 느린 작업을 잠금 안에 넣지 않는다.
  const { validationErrors, baseline } = await withDataLock(dataDir, async () => {
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

    return { validationErrors, baseline: hashDataFiles(dataDir, BASELINE_FILES) };
  });

  const token = stageImport(KIND, { basis, accountId, baseline });

  return { token, count: basis.length, accountId, validationErrors, crossCheck };
}

/**
 * 미리보기 토큰으로 실제 반영한다. 동시성 검사·검증·백업·쓰기를 전부 같은 잠금
 * 안에서 한다 — 잠금 밖에서 "바뀌었는지 확인"하고 잠금 안에서 "쓰기"를 하면 그
 * 사이(TOCTOU)에 cron이나 다른 가져오기가 끼어들 수 있기 때문이다.
 */
export async function applyPositionBasis(token: string): Promise<ApplyResult> {
  await requireAuthenticatedSession();
  let staged: { basis: PositionBasis[]; accountId: string; baseline: Record<string, string> };
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
      const transactions = readJson<{ at: string }[]>("transactions.json");
      const cashflows = readJson<{ at: string }[]>("cashflows.json");

      const validationErrors = [
        ...validatePositionBasis(staged.basis, { accountIds, symbolIds }),
        ...validateBasisNotRegressing(staged.basis, { transactions, cashflows }),
      ] as string[];
      if (validationErrors.length > 0) return { ok: false, errors: validationErrors };

      backupData(dataDir, backupRoot);
      writeJsonAtomic(join(dataDir, "position-basis.json"), `${JSON.stringify(staged.basis, null, 2)}\n`);

      return { ok: true, message: `현재 잔고 기준 ${staged.basis.length}종목을 반영했습니다.` };
    });
  } catch (error) {
    // 잠금 획득·백업·쓰기 자체가 실패한 경우(위 return들과 달리 예기치 못한 예외) —
    // 이 시점까지 data/ 파일은 전혀 바뀌지 않았으니, staged 데이터를 다시
    // 스테이징해서 재업로드 없이 재시도할 수 있게 한다.
    const retryToken = stageImport(KIND, staged);
    return {
      ok: false,
      errors: [`반영 중 오류가 발생했습니다: ${(error as Error).message} (데이터는 바뀌지 않았습니다 — 다시 시도할 수 있습니다.)`],
      retryToken,
    };
  }
}
