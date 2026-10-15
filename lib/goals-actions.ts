"use server";

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { refresh } from "next/cache";

import { requireAuthenticatedSession } from "./auth/guard";
import { withDataLock, writeJsonAtomic } from "./data/atomic-write";
import { goalError, type AssetGoal } from "./domain/goals";
import { dataDir } from "./import/paths";

/** 캘린더에서 저장하는 총 평가금액 목표(`data/goals.json`). 같은 날짜는 덮어쓴다. */

export type GoalActionState = { ok: boolean; message: string } | null;

const FILE = "goals.json";

function readGoals(): AssetGoal[] {
  try {
    return JSON.parse(readFileSync(join(dataDir, FILE), "utf8")) as AssetGoal[];
  } catch {
    return [];
  }
}

async function writeGoals(update: (goals: AssetGoal[]) => AssetGoal[]) {
  await withDataLock(dataDir, async () => {
    const next = update(readGoals()).sort((a, b) => a.date.localeCompare(b.date));
    writeJsonAtomic(join(dataDir, FILE), `${JSON.stringify(next, null, 2)}\n`);
  });
}

export async function saveGoal(_prev: GoalActionState, formData: FormData): Promise<GoalActionState> {
  await requireAuthenticatedSession();
  const date = String(formData.get("date") ?? "");
  // 입력은 억 원 단위다(예: 12.5 → 12억 5천만 원).
  const amountKrw = Math.round(Number(formData.get("amountEok")) * 100_000_000);
  const error = goalError({ date, amountKrw });
  if (error) return { ok: false, message: error };

  try {
    await writeGoals((goals) => [...goals.filter((g) => g.date !== date), { date, amountKrw }]);
  } catch (e) {
    return { ok: false, message: `저장하지 못했습니다. 잠시 뒤 다시 시도해 주세요. (${(e as Error).message})` };
  }
  refresh();
  return { ok: true, message: "목표를 저장했습니다." };
}

export async function deleteGoal(date: string): Promise<GoalActionState> {
  await requireAuthenticatedSession();
  try {
    await writeGoals((goals) => goals.filter((g) => g.date !== date));
  } catch (e) {
    return { ok: false, message: `지우지 못했습니다. (${(e as Error).message})` };
  }
  refresh();
  return { ok: true, message: "목표를 지웠습니다." };
}
