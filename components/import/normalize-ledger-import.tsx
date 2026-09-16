"use client";

import { useState, useTransition } from "react";

import { applyFinished, applyStarted, applyThrew } from "@/lib/import/apply-ui-state";
import {
  applyNormalizeLedger,
  previewNormalizeLedger,
  type NormalizeLedgerPreview,
} from "@/lib/import/normalize-ledger-actions";
import { Card } from "@/components/ui/primitives";

import { ValidationList } from "./validation-list";

/**
 * 파일 업로드가 없다 — 지금 원장(transactions.json/cashflows.json)의 이체·
 * 액면분할·현금흐름 성격을 다시 정규화한다. 미리보기 → 확인 → 적용
 * (자동 백업 후 반영) 순서는 다른 두 가져오기와 같다.
 */
export function NormalizeLedgerImportSection() {
  const [preview, setPreview] = useState<NormalizeLedgerPreview | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const canApply = preview !== null && preview.validationErrors.length === 0;

  function handlePreview() {
    setError(null);
    setResult(null);
    startTransition(async () => {
      try {
        setPreview(await previewNormalizeLedger());
      } catch (e) {
        setError((e as Error).message);
      }
    });
  }

  function applyState(state: { preview: NormalizeLedgerPreview | null; error: string | null; result: string | null }) {
    setPreview(state.preview);
    setError(state.error);
    setResult(state.result);
  }

  function handleApply() {
    if (!preview) return;
    applyState(applyStarted(preview));
    startTransition(async () => {
      try {
        const res = await applyNormalizeLedger(preview.token);
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
      <h3 className="text-[15px] font-semibold tracking-tight">원장 정규화</h3>
      <p className="mt-1 text-xs leading-5 text-muted">
        업로드가 아니라 지금 저장된 거래·현금흐름을 다시 훑어 이체·액면분할과 환전·배당·보정 성격을 다시 매긴다. CSV를 새로
        가져온 뒤 한 번 돌리면 좋다.
      </p>

      {!preview ? (
        <button
          type="button"
          onClick={handlePreview}
          disabled={pending}
          className="mt-4 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white transition-opacity disabled:opacity-50"
        >
          {pending ? "확인하는 중..." : "미리보기"}
        </button>
      ) : (
        <div className="mt-4 space-y-3">
          <p className="text-xs text-muted">
            거래 <span className="font-semibold text-text">{preview.transactionCount}건</span> · 현금흐름{" "}
            <span className="font-semibold text-text">{preview.cashflowCount}건</span>
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
