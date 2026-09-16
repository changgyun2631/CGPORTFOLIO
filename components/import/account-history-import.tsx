"use client";

import { useState, useTransition } from "react";

import {
  applyAccountHistory,
  previewAccountHistory,
  type AccountHistoryPreview,
} from "@/lib/import/account-history-actions";
import { Card } from "@/components/ui/primitives";

import { ValidationList } from "./validation-list";

/**
 * 계좌수익률 CSV(여러 개 가능)의 일별 예탁자산을 총 평가금액 스냅샷으로
 * 가져온다. 미리보기 → 확인 → 적용(자동 백업 후 반영) 순서다.
 */
export function AccountHistoryImportSection() {
  const [preview, setPreview] = useState<AccountHistoryPreview | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const canApply = preview !== null && preview.validationErrors.length === 0;

  function handlePreview(formData: FormData) {
    setError(null);
    setResult(null);
    startTransition(async () => {
      try {
        setPreview(await previewAccountHistory(formData));
      } catch (e) {
        setError((e as Error).message);
      }
    });
  }

  function handleApply() {
    if (!preview) return;
    startTransition(async () => {
      try {
        const res = await applyAccountHistory(preview.token);
        if (res.ok) {
          setResult(res.message);
          setPreview(null);
        } else if (res.retryToken) {
          setPreview({ ...preview, token: res.retryToken });
          setError(res.errors.join(" / "));
        } else {
          setPreview(null);
          setError(res.errors.join(" / "));
        }
      } catch (e) {
        setPreview(null);
        setError((e as Error).message);
      }
    });
  }

  function handleCancel() {
    setPreview(null);
    setError(null);
  }

  return (
    <Card>
      <h3 className="text-[15px] font-semibold tracking-tight">계좌수익률 CSV</h3>
      <p className="mt-1 text-xs leading-5 text-muted">
        일별 예탁자산과 입금·출금을 총 평가금액 차트의 스냅샷으로 가져옵니다. 여러 계좌 CSV를 한 번에 선택하면 같은 날짜끼리
        합산합니다.
      </p>

      {!preview ? (
        <form action={handlePreview} className="mt-4 space-y-3">
          <div>
            <label className="block text-xs font-medium text-muted" htmlFor="account-history-files">
              CSV 파일 (여러 개 선택 가능)
            </label>
            <input
              id="account-history-files"
              type="file"
              name="files"
              accept=".csv"
              multiple
              required
              className="mt-1 block w-full text-xs"
            />
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
            파일 <span className="font-semibold text-text">{preview.fileCount}개</span> ·{" "}
            <span className="font-semibold text-text">{preview.dayCount}일</span>의 실제 기록 · 병합 후{" "}
            <span className="font-semibold text-text">{preview.snapshotCount}개</span> 스냅샷
          </p>
          <ValidationList errors={preview.validationErrors} />
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
