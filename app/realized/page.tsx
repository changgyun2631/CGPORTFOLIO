import type { Metadata } from "next";
import Link from "next/link";

import { Card, Empty, PageTitle, Section, Stat } from "@/components/ui/primitives";
import { loadRealizedByYear } from "@/lib/data/views";
import { OVERSEAS_ANNUAL_DEDUCTION_KRW, OVERSEAS_TAX_RATE } from "@/lib/domain/realized-tax";
import { money, moneySigned, percent } from "@/lib/format";

export const metadata: Metadata = { title: "실현손익" };

// 매매 내역이 CSV 가져오기로 갱신되므로 재빌드 없이 다음 요청에 바로 반영돼야 한다.
export const dynamic = "force-dynamic";

export default async function RealizedPage({ searchParams }: { searchParams: Promise<{ year?: string }> }) {
  const [byYear, params] = await Promise.all([loadRealizedByYear(), searchParams]);

  if (byYear.length === 0) {
    return (
      <div className="space-y-8">
        <PageTitle title="실현손익" />
        <Empty title="매도 기록이 없습니다" description="매도가 발생하면 연도별 실현손익과 예상 양도세가 여기에 집계됩니다." />
      </div>
    );
  }

  const years = byYear.map((y) => y.year); // 최신 연도부터 정렬돼 있다.
  const year = params.year && years.includes(params.year) ? params.year : years[0];
  const selected = byYear.find((y) => y.year === year)!;
  const deductionUsedPercent =
    (Math.min(Math.max(selected.overseasRealizedKrw, 0), OVERSEAS_ANNUAL_DEDUCTION_KRW) / OVERSEAS_ANNUAL_DEDUCTION_KRW) * 100;

  return (
    <div className="space-y-8">
      <PageTitle
        title="실현손익"
        description="매도로 확정된 손익을 연도별로 묶고, 해외주식 양도소득세를 추정합니다. 신고용이 아니라 참고용 추정입니다."
      />

      <Section
        title={`${year}년`}
        description={`매도 ${selected.sellCount}건 · 실현손익 합계 ${moneySigned(selected.totalRealizedKrw)}`}
        action={
          years.length > 1 ? (
            <div className="flex flex-wrap gap-1.5">
              {years.map((y) => (
                <Link
                  key={y}
                  href={`/realized?year=${y}`}
                  aria-current={y === year ? "page" : undefined}
                  className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${
                    y === year ? "bg-accent text-white" : "border border-line text-muted hover:border-line-strong hover:text-text"
                  }`}
                >
                  {y}
                </Link>
              ))}
            </div>
          ) : undefined
        }
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat
            label="해외주식 실현손익"
            value={moneySigned(selected.overseasRealizedKrw)}
            tone={selected.overseasRealizedKrw >= 0 ? "up" : "down"}
            sub="양도소득세 대상"
          />
          <Stat
            label="남은 기본공제"
            value={money(selected.remainingDeductionKrw)}
            sub={`연 ${money(OVERSEAS_ANNUAL_DEDUCTION_KRW)} 중 ${percent(deductionUsedPercent)} 사용`}
          />
          <Stat
            label="예상 양도세"
            value={money(selected.estimatedTaxKrw)}
            tone={selected.estimatedTaxKrw > 0 ? "down" : "default"}
            sub={selected.taxableKrw > 0 ? `과세표준 ${money(selected.taxableKrw)} × ${percent(OVERSEAS_TAX_RATE * 100)}` : "공제 범위 안"}
          />
          <Stat
            label={selected.pensionRealizedKrw !== 0 ? "연금계좌 실현손익" : "국내주식 실현손익"}
            value={moneySigned(
              selected.pensionRealizedKrw !== 0 ? selected.pensionRealizedKrw : selected.domesticRealizedKrw,
            )}
            tone={
              (selected.pensionRealizedKrw !== 0 ? selected.pensionRealizedKrw : selected.domesticRealizedKrw) >= 0
                ? "up"
                : "down"
            }
            sub={
              selected.pensionRealizedKrw !== 0
                ? `양도세 비대상 · 국내주식 ${moneySigned(selected.domesticRealizedKrw)}`
                : "대주주가 아니면 비과세"
            }
          />
        </div>

        {selected.sellFeeKrw > 0 ? (
          <Card className="mt-3">
            <h3 className="text-[13px] font-semibold">증권사 화면과 대조하기</h3>
            <p className="mt-1.5 text-[12px] leading-5 text-muted">
              위 금액은 <b>매수·매도 수수료를 모두 뺀</b> 실제 손익입니다. 증권사 실현손익 화면은 수수료를 덜 빼고 보여주는
              경우가 있어, 숫자가 안 맞으면 아래처럼 맞춰 보세요.
            </p>
            <dl className="tnum mt-2.5 space-y-1 border-t border-line pt-2.5 text-[12px]">
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-faint">실현손익 합계</dt>
                <dd className="font-semibold">{moneySigned(selected.totalRealizedKrw)}</dd>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-faint">＋ 차감한 매도 수수료</dt>
                <dd className="font-semibold">{money(selected.sellFeeKrw)}</dd>
              </div>
              <div className="flex items-baseline justify-between gap-3 border-t border-line pt-1">
                <dt className="text-faint">＝ 매도 수수료 차감 전</dt>
                <dd className="text-sm font-bold">{moneySigned(selected.totalRealizedKrw + selected.sellFeeKrw)}</dd>
              </div>
            </dl>
            <p className="mt-2 text-[11px] leading-4 text-faint">
              그래도 1% 안팎이 남으면 환율 출처 차이입니다 — 이 화면은 일별 종가 환율을, 증권사는 결제일 매매기준율을 씁니다.
              매수 수수료는 취득원가에 녹아 있어 연도별로 따로 가를 수 없습니다.
            </p>
          </Card>
        ) : null}
      </Section>

      <Section title="종목별" description={`${selected.lines.length}종목`}>
        <Card padded={false}>
          <ul className="divide-y divide-line">
            {selected.lines.map((line) => (
              <li key={line.symbolId} className="flex items-center gap-3 px-4 py-3 text-[13px]">
                <Link href={`/symbols/${encodeURIComponent(line.symbolId)}`} className="font-bold tracking-tight hover:underline">
                  {line.symbolId}
                </Link>
                <span className="min-w-0 flex-1 truncate text-faint">{line.name}</span>
                <span className="shrink-0 rounded border border-line px-1.5 py-0.5 text-[10px] text-faint">
                  {line.bucket === "overseas" ? "해외" : line.bucket === "domestic" ? "국내" : "연금"}
                </span>
                <span className="tnum shrink-0 text-muted">{line.tradeCount}건</span>
                <span className={`tnum w-[120px] shrink-0 text-right font-semibold ${line.realizedKrw >= 0 ? "text-up" : "text-down"}`}>
                  {moneySigned(line.realizedKrw)}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      </Section>

      <Section title="연도별 추이" description="합계는 국내·해외를 모두 더한 값이고, 양도세는 해외분에만 붙습니다.">
        <Card padded={false}>
          <ul className="divide-y divide-line">
            <li className="flex items-center gap-3 px-4 py-2 text-[11px] text-faint">
              <span className="w-[52px] shrink-0">연도</span>
              <span className="min-w-0 flex-1">매도</span>
              <span className="w-[120px] shrink-0 text-right">실현손익 합계</span>
              <span className="w-[120px] shrink-0 text-right">해외분</span>
              <span className="w-[110px] shrink-0 text-right">예상 양도세</span>
            </li>
            {byYear.map((row) => (
              <li key={row.year} className="flex items-center gap-3 px-4 py-3 text-[13px]">
                <Link
                  href={`/realized?year=${row.year}`}
                  className={`w-[52px] shrink-0 font-bold tracking-tight hover:underline ${row.year === year ? "text-accent" : ""}`}
                >
                  {row.year}
                </Link>
                <span className="tnum min-w-0 flex-1 text-faint">{row.sellCount}건</span>
                <span
                  className={`tnum w-[120px] shrink-0 text-right font-semibold ${
                    row.totalRealizedKrw >= 0 ? "text-up" : "text-down"
                  }`}
                >
                  {moneySigned(row.totalRealizedKrw)}
                </span>
                <span className="tnum w-[120px] shrink-0 text-right text-muted">{moneySigned(row.overseasRealizedKrw)}</span>
                <span className="tnum w-[110px] shrink-0 text-right font-semibold text-down">
                  {row.estimatedTaxKrw > 0 ? money(row.estimatedTaxKrw) : "—"}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      </Section>

      <Card>
        <h3 className="text-[13px] font-semibold">이 숫자를 그대로 신고에 쓰지 마세요</h3>
        <ul className="mt-2 space-y-1.5 text-[12px] leading-5 text-muted">
          <li>
            · 세법은 양도가액과 취득가액을 <b>각각 그 결제일 환율</b>로 환산해 차익을 냅니다. 여기서는 종목 통화 기준 차익을 구한 뒤
            매도일 환율로만 환산하므로, 보유 기간의 환율 변동만큼 차이가 납니다.
          </li>
          <li>· 기본공제 {money(OVERSEAS_ANNUAL_DEDUCTION_KRW)}·세율 {percent(OVERSEAS_TAX_RATE * 100)}는 코드에 고정된 값입니다. 세법이 바뀌면 같이 고쳐야 합니다.</li>
          <li>· 증권사에서 제공하는 양도소득세 계산 내역과 대조해 보시고, 실제 신고는 그쪽 수치를 기준으로 하세요.</li>
        </ul>
      </Card>
    </div>
  );
}
