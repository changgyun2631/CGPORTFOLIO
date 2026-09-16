import type { Metadata } from "next";

import { AccountHistoryImportSection } from "@/components/import/account-history-import";
import { NormalizeLedgerImportSection } from "@/components/import/normalize-ledger-import";
import { PositionBasisImportSection } from "@/components/import/position-basis-import";
import { PageTitle } from "@/components/ui/primitives";

export const metadata: Metadata = { title: "CSV 가져오기" };

// 데이터 반영 직후 다른 페이지가 새 값을 보게 하려면 이 화면도 매 요청 서버
// 렌더링이어야 한다(원칙은 다른 실데이터 페이지와 같다 — WORK_ORDER B 참고).
export const dynamic = "force-dynamic";

export default function ImportPage() {
  return (
    <div className="space-y-8">
      <PageTitle
        title="CSV 가져오기"
        description="증권사 CSV로 잔고·계좌수익률을 가져오고 원장을 정규화합니다. 미리보기에서 검증을 통과해야 적용 버튼이 켜집니다."
      />

      <p className="rounded-xl border border-line bg-bg-elevated px-4 py-3 text-xs leading-5 text-muted">
        이 화면은 로컬 전용입니다 — 인증이 없으니 외부에 공개하지 마세요. 적용을 누르면 그 직전에 자동으로 전체 백업을 만들고,
        검증에 실패하면 기존 데이터는 전혀 바뀌지 않습니다. 미리보기만 하고 적용을 누르지 않으면(또는 이 페이지를 떠나면) 아무
        일도 일어나지 않습니다.
      </p>

      <PositionBasisImportSection />
      <AccountHistoryImportSection />
      <NormalizeLedgerImportSection />
    </div>
  );
}
