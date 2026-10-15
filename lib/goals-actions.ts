"use server";

import { unlinkSync } from "node:fs";
import { join } from "node:path";

import { refresh } from "next/cache";

import { requireAuthenticatedSession } from "./auth/guard";
import { withDataLock, writeJsonAtomic } from "./data/atomic-write";
import { goalError, type AssetGoal } from "./domain/goals";
import { dataDir } from "./import/paths";

/** 캘린더에서 저장하는 총 평가금액 목표(`data/goals.json`). 목표는 하나뿐이다. */

export type GoalActionState = { ok: boolean; message: string } | null;

const FILE = "goals.json";

export async function saveGoal(_prev: GoalActionState, formData: FormData): Promise<GoalActionState> {
  await requireAuthenticatedSession();
  // 입력은 억 원 단위다(예: 12.5 → 12억 5천만 원).
  const amountKrw = Math.round(Number(formData.get("amountEok")) * 100_000_000);
  const error = goalError(amountKrw);
  if (error) return { ok: false, message: error };

  const goal: AssetGoal = { amountKrw };
  try {
    await withDataLock(dataDir, async () => writeJsonAtomic(join(dataDir, FILE), `${JSON.stringify(goal, null, 2)}\n`));
  } catch (e) {
    return { ok: false, message: `저장하지 못했습니다. 잠시 뒤 다시 시도해 주세요. (${(e as Error).message})` };
  }
  refresh();
  return { ok: true, message: "목표를 저장했습니다." };
}

export async function deleteGoal(): Promise<GoalActionState> {
  await requireAuthenticatedSession();
  try {
    await withDataLock(dataDir, async () => {
      try {
        unlinkSync(join(dataDir, FILE));
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      }
    });
  } catch (e) {
    return { ok: false, message: `지우지 못했습니다. (${(e as Error).message})` };
  }
  refresh();
  return { ok: true, message: "목표를 지웠습니다." };
}
