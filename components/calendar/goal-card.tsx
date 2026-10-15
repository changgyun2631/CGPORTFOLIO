"use client";

import { useActionState, useState, useTransition } from "react";

import { goalProgress, type AssetGoal } from "@/lib/domain/goals";
import { eok } from "@/lib/format";
import { deleteGoal, saveGoal, type GoalActionState } from "@/lib/goals-actions";

/** 총 평가금액 목표 — 금액 하나를 정해 두고 지금 평가금액과 계속 비교한다. */
export function GoalCard({ currentKrw, goal }: { currentKrw: number; goal: AssetGoal | null }) {
  const [editing, setEditing] = useState(goal === null);
  const [state, formAction, saving] = useActionState(async (prev: GoalActionState, formData: FormData) => {
    const result = await saveGoal(prev, formData);
    if (result?.ok) setEditing(false);
    return result;
  }, null);
  const [deleting, startDelete] = useTransition();
  const [deleteMessage, setDeleteMessage] = useState<string | null>(null);
  const progress = goal ? goalProgress(currentKrw, goal) : null;
  const message = deleteMessage ?? state?.message;

  return (
    <section className="rounded-2xl border border-line-strong bg-surface p-5">
      <div className="grid gap-5 sm:grid-cols-3">
        <Figure label="현재 총 평가금액" value={eok(currentKrw)} />
        <Figure label="목표" value={goal ? eok(goal.amountKrw) : "—"} accent />
        <Figure
          label={progress && progress.remainingKrw <= 0 ? "목표 초과" : "남은 금액"}
          value={progress ? `${progress.remainingKrw <= 0 ? "+" : ""}${eok(Math.abs(progress.remainingKrw))}` : "—"}
          tone={progress ? (progress.remainingKrw <= 0 ? "up" : "down") : undefined}
        />
      </div>

      {progress ? (
        <div className="mt-5">
          <div className="flex items-baseline justify-between text-xs text-muted">
            <span>달성률</span>
            <span className="tnum text-sm font-bold text-text">{progress.percent.toFixed(1)}%</span>
          </div>
          <div className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-bg-elevated">
            <div className="h-full rounded-full bg-accent" style={{ width: `${Math.min(progress.percent, 100)}%` }} />
          </div>
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap items-end gap-3 border-t border-line pt-4">
        {editing ? (
          <form action={formAction} className="flex flex-wrap items-end gap-2">
            <label className="grid gap-1 text-xs text-muted">
              목표금액 (억 원)
              <input
                name="amountEok"
                type="number"
                inputMode="decimal"
                step="0.0001"
                min="0"
                required
                defaultValue={goal ? goal.amountKrw / 100_000_000 : undefined}
                placeholder="예: 10"
                className="tnum w-36 rounded-lg border border-line bg-bg-elevated px-2.5 py-1.5 text-sm text-text"
              />
            </label>
            <button type="submit" disabled={saving} className="rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50">
              저장
            </button>
            {goal ? (
              <button type="button" onClick={() => setEditing(false)} className="px-2 py-1.5 text-sm text-muted hover:text-text">
                취소
              </button>
            ) : null}
          </form>
        ) : (
          <>
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="rounded-lg border border-line px-3 py-1.5 text-sm text-muted transition-colors hover:border-line-strong hover:text-text"
            >
              목표 바꾸기
            </button>
            <button
              type="button"
              disabled={deleting}
              onClick={() =>
                startDelete(async () => {
                  const result = await deleteGoal();
                  setDeleteMessage(result?.message ?? null);
                  setEditing(true);
                })
              }
              className="px-2 py-1.5 text-sm text-muted hover:text-down disabled:opacity-50"
            >
              목표 지우기
            </button>
          </>
        )}
        {message ? <p className={`text-xs ${state && !state.ok ? "text-down" : "text-muted"}`}>{message}</p> : null}
      </div>
    </section>
  );
}

function Figure({ label, value, tone, accent }: { label: string; value: string; tone?: "up" | "down"; accent?: boolean }) {
  const color = tone === "up" ? "text-up" : tone === "down" ? "text-down" : accent ? "text-accent" : "text-text";
  return (
    <div>
      <p className="text-sm font-semibold text-muted">{label}</p>
      <p className={`tnum mt-1.5 text-[24px] font-bold leading-tight tracking-tight ${color}`}>{value}</p>
    </div>
  );
}
