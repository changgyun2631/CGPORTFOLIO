"use client";

import { useState, useTransition } from "react";

import { applyFinished, applyStarted, applyThrew } from "@/lib/import/apply-ui-state";
import { MAX_FILE_BYTES, formatBytes } from "@/lib/import/limits-shared";
import { applyPositionBasis, previewPositionBasis, type PositionBasisPreview } from "@/lib/import/position-basis-actions";
import { Card } from "@/components/ui/primitives";

import { ValidationList } from "./validation-list";

/**
 * 증권사 "보유종목" CSV로 현재 잔고 기준값을 가져온다. 미리보기(파싱·검증·
 * 교차검증) → 확인 → 적용(자동 백업 후 반영) 순서다. 적용 전에는 아무 파일도
 * 바뀌지 않는다.
 */
export function PositionBasisImportSection({
  accounts,
}: {
  /** 등록된 계좌 목록. 계좌 ID를 손으로 적으면 오타 하나로 엉뚱한 계좌에 들어간다. */
  accounts: { id: string; name: string; broker?: string }[];
}) {
  const [preview, setPreview] = useState<PositionBasisPreview | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const canApply = preview !== null && preview.validationErrors.length === 0 && preview.crossCheck.ok;

  function handlePreview(formData: FormData) {
    setError(null);
    setResult(null);
    startTransition(async () => {
      try {
        setPreview(await previewPositionBasis(formData));
      } catch (e) {
        setError((e as Error).message);
      }
    });
  }

  function applyState(state: { preview: PositionBasisPreview | null; error: string | null; result: string | null }) {
    setPreview(state.preview);
    setError(state.error);
    setResult(state.result);
  }

  function handleApply() {
    if (!preview) return;
    applyState(applyStarted(preview)); // 이전 시도의 성공/오류 문구를 먼저 지운다 — 실패→재시도 성공 뒤 둘 다 보이던 문제(WORK_ORDER B-0A-5)
    startTransition(async () => {
      try {
        const res = await applyPositionBasis(preview.token);
        applyState(applyFinished(preview, res));
      } catch (e) {
        applyState(applyThrew(e));
      }
    });
  }

  function handleCancel() {
    setPreview(null);
    setError(null);
  }

  return (
    <Card>
      <h3 className="text-[15px] font-semibold tracking-tight">보유종목(잔고) CSV</h3>
      <p className="mt-1 text-xs leading-5 text-muted">
        현재 보유수량·매입원가·예상 매도수수료율을 증권사 잔고 CSV에서 가져옵니다. 반영하면 기존 잔고 기준값을 통째로 교체합니다.
      </p>

      {!preview ? (
        <form action={handlePreview} className="mt-4 space-y-3">
          <div>
            <label className="block text-xs font-medium text-muted" htmlFor="position-basis-account-id">
              계좌
            </label>
            <select
              id="position-basis-account-id"
              name="accountId"
              required
              defaultValue=""
              className="mt-1 w-full rounded-lg border border-line bg-bg px-3 py-1.5 text-sm text-text outline-none focus:border-accent"
            >
              <option value="" disabled>
                계좌를 고르세요
              </option>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.broker ? `${account.broker} · ` : ""}
                  {account.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-muted" htmlFor="position-basis-file">
              CSV 파일
            </label>
            <input id="position-basis-file" type="file" name="file" accept=".csv" required className="mt-1 block w-full text-xs" />
            <p className="mt-1 text-[11px] text-faint">.csv 파일 1개, 최대 {formatBytes(MAX_FILE_BYTES)}</p>
          </div>
          <button
            type="submit"
            disabled={pending}
            className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white transition-opacity disabled:opacity-50"
          >
            {pending ? "확인하는 중..." : "미리보기"}
          </button>
        </form>
      ) : (
        <div className="mt-4 space-y-3">
          <p className="text-xs text-muted">
            파싱된 종목 <span className="font-semibold text-text">{preview.count}개</span> · 계좌{" "}
            <span className="font-semibold text-text">{preview.accountId}</span>
          </p>
          <ValidationList errors={preview.validationErrors} />
          {preview.crossCheck.ok ? (
            <p className="text-xs font-medium text-up">교차검증 통과 — CSV의 평가손익과 재계산값이 일치합니다</p>
          ) : (
            <div className="rounded-lg border border-down/40 bg-down-soft px-3 py-2">
              <p className="text-xs font-semibold text-down">
                교차검증 실패: {preview.crossCheck.exceeded.length}개 종목이 허용 오차(±{preview.crossCheck.toleranceKrw}원)를
                초과했습니다
              </p>
              <p className="mt-0.5 text-[11px] text-down">{preview.crossCheck.exceeded.join(", ")}</p>
            </div>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleApply}
              disabled={!canApply || pending}
              className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white transition-opacity disabled:opacity-50"
            >
              {pending ? "반영하는 중..." : "적용 (자동 백업 후 반영)"}
            </button>
            <button
              type="button"
              onClick={handleCancel}
              disabled={pending}
              className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:border-line-strong hover:text-text disabled:opacity-50"
            >
              취소
            </button>
          </div>
        </div>
      )}

      {error ? <p className="mt-3 text-xs font-medium text-down">{error}</p> : null}
      {result ? <p className="mt-3 text-xs font-medium text-up">{result}</p> : null}
    </Card>
  );
}
