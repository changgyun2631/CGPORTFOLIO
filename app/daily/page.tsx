import type { Metadata } from "next";

import { DailyGainList } from "@/components/daily/daily-gain-list";
import { Card, Empty, PageTitle } from "@/components/ui/primitives";
import { loadDailyGains } from "@/lib/data/views";

export const metadata: Metadata = { title: "일별손익" };

// 스냅샷은 cron이 계속 쌓으므로 재빌드 없이 다음 요청에 바로 반영돼야 한다.
export const dynamic = "force-dynamic";

export default async function DailyPage() {
  const rows = await loadDailyGains();

  if (rows.length < 2) {
    return (
      <div className="space-y-8">
        <PageTitle title="일별손익" />
        <Empty title="비교할 날짜가 없습니다" description="평가금액 기록이 이틀 이상 쌓이면 날짜별 증감이 여기에 나옵니다." />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <PageTitle
        title="일별손익"
        description="매일 평가손익이 얼마나 늘고 줄었는지 보여줍니다. 대시보드 차트의 '전일 대비 이익'과 같은 값이며, 입출금은 빠집니다. 날짜를 누르면 종목별 증감이 열립니다."
      />

      <DailyGainList rows={rows} />

      <Card>
        <h3 className="text-[13px] font-semibold">종목별 증감은 이렇게 계산합니다</h3>
        <ul className="mt-2 space-y-1.5 text-[12px] leading-5 text-muted">
          <li>
            · 스냅샷에는 종목별 값이 없어서, 매매내역으로 그날 보유 수량을 다시 구하고 그날 종가·환율로 평가한 전일 대비 증감입니다.
            매수·매도한 금액은 손익으로 치지 않습니다.
          </li>
          <li>
            · 맨 아래 <b>기타</b>는 일 손익에서 종목 합을 뺀 차이입니다. 배당, 예수금의 환율 변동, 증권사 예탁자산과 이 대시보드 계산의
            차이가 모입니다. 기록 출처가 증권사 CSV에서 자동 갱신으로 바뀌는 구간에서 특히 커집니다.
          </li>
          <li>· 종가를 알 수 없는 종목은 추정해서 채우지 않고 기타에 남깁니다.</li>
        </ul>
      </Card>
    </div>
  );
}
