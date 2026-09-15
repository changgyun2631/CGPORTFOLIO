import type { Metadata } from "next";
import Link from "next/link";

import { MarkdownBody } from "@/components/reports/markdown-body";
import { Card, Empty, PageTitle, Stat } from "@/components/ui/primitives";
import { getPhilosophy } from "@/lib/data/store";
import { loadPortfolio } from "@/lib/data/views";
import { money, percent } from "@/lib/format";

export const metadata: Metadata = { title: "투자철학" };

/** 원칙 문서에 적어둔 기준을 실제 보유 상태와 맞춰 본다. */
const LEVERAGE_SYMBOLS = ["QLD", "TQQQ", "418660"];
const INCOME_SYMBOLS = ["490590", "491620", "SCHD"];

export default async function PhilosophyPage() {
  const [body, portfolio] = await Promise.all([getPhilosophy(), loadPortfolio()]);
  const { holdings, totals } = portfolio;

  const sumWeight = (ids: string[]) =>
    holdings.filter((h) => ids.includes(h.symbolId)).reduce((sum, h) => sum + h.weight, 0);

  const leverage = sumWeight(LEVERAGE_SYMBOLS);
  const income = sumWeight(INCOME_SYMBOLS);
  const cash = holdings.filter((h) => h.kind === "cash").reduce((sum, h) => sum + h.weight, 0);

  return (
    <div className="space-y-8">
      <PageTitle
        title="투자철학"
        description="흔들릴 때 판단하지 않기 위해, 흔들리기 전에 정해 둔 것들입니다."
      />

      {/* 원칙과 현재 상태를 같은 화면에 둔다. 글만 있으면 지켜지는지 알 수 없다. */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="레버리지 비중" value={percent(leverage, 1)} sub={LEVERAGE_SYMBOLS.join(" · ")} />
        <Stat label="인컴 비중" value={percent(income, 1)} sub={INCOME_SYMBOLS.join(" · ")} />
        <Stat label="현금 비중" value={percent(cash, 1)} sub="예수금 합계" />
        <Stat label="총 평가금액" value={money(totals.totalKrw)} sub={`${totals.symbolCount}개 종목`} href="/" />
      </div>

      <p className="rounded-xl border border-line bg-bg-elevated px-4 py-3 text-xs leading-5 text-muted">
        위 비중 분류는 <code className="rounded border border-line px-1">app/philosophy/page.tsx</code> 상단의 종목 목록으로
        정합니다. 종목을 새로 담으면 그 목록에도 넣어야 계산에 잡힙니다. 원칙 본문은{" "}
        <code className="rounded border border-line px-1">data/philosophy.md</code> 입니다.
      </p>

      {body ? (
        <Card className="mx-auto max-w-[760px] sm:p-7">
          <MarkdownBody source={body} />
        </Card>
      ) : (
        <Empty title="작성한 원칙이 없습니다" description="data/philosophy.md 에 내용을 채우세요." />
      )}

      <div className="mx-auto max-w-[760px]">
        <Link href="/reports" className="text-xs text-accent hover:underline">
          원칙을 바꾼 이유는 리포트에 남깁니다 →
        </Link>
      </div>
    </div>
  );
}
