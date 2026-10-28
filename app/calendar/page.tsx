import type { Metadata } from "next";

import { GoalCard } from "@/components/calendar/goal-card";
import { EventRow, MonthCalendar } from "@/components/calendar/month-calendar";
import { Card, PageTitle, Section } from "@/components/ui/primitives";
import { getCalendarEvents, getCalendarResults, getGoal, getLogoSymbols } from "@/lib/data/store";
import { loadPortfolio } from "@/lib/data/views";
import { seoulDate } from "@/lib/domain/calendar-results";

export const metadata: Metadata = { title: "캘린더" };
// 예약 스크립트가 바꾼 결과 파일과 새로 저장한 목표를 새 요청에서 즉시 읽는다.
export const dynamic = "force-dynamic";

/** 아래 "발표 결과"에 지난 며칠치 일정을 모을지 */
const RESULT_DAYS = 45;

export default async function CalendarPage() {
  const [events, data, goal, { totals }, logoList] = await Promise.all([getCalendarEvents(), getCalendarResults(), getGoal(), loadPortfolio(), getLogoSymbols()]);
  const now = new Date();
  const today = seoulDate(now);
  const results = data?.results ?? {};

  // 결과를 받을 수 있는 일정 중 발표일이 지난 것 — 최근 것이 위.
  const since = seoulDate(new Date(now.getTime() - RESULT_DAYS * 86_400_000));
  const released = events
    .filter((event) => event.resultSource && event.date <= today && event.date >= since)
    .sort((a, b) => b.date.localeCompare(a.date));

  return (
    <div className="space-y-8">
      <PageTitle title="캘린더" description="보유 종목 실적 발표·경제지표 일정과 발표 결과, 총 평가금액 목표를 봅니다." />

      <GoalCard currentKrw={totals.totalKrw} goal={goal} />

      <MonthCalendar events={events} results={results} logos={logoList} today={today} nowMs={now.getTime()} />

      <Section title="발표 결과" description={`최근 ${RESULT_DAYS}일 동안 발표된 실적·지표입니다. 공시가 올라오는 대로 6시간마다 채워집니다.`}>
        <Card>
          {released.length === 0 ? (
            <p className="text-sm text-faint">최근 발표된 일정이 없습니다.</p>
          ) : (
            <ul className="divide-y divide-line">
              {released.map((event) => (
                <EventRow key={event.id} event={event} result={results[event.id]} nowMs={now.getTime()} showDate logo={event.symbolId ? logoList.includes(event.symbolId) : false} />
              ))}
            </ul>
          )}
        </Card>
      </Section>

      <Card>
        <p className="text-sm font-semibold">일정과 결과는 무료 공개 자료로 채웁니다</p>
        <p className="mt-2 text-sm leading-6 text-muted">
          보유 종목의 실적 발표일은 하루 한 번 나스닥 실적 캘린더에서 앞으로 90일치를 확인해 자동으로 넣습니다. 결과는 발표 뒤 SEC에 올라오는 분기
          공시(매출·희석 EPS)와 BLS 고용보고서를 6시간마다 확인합니다. 시장 예상치 대비 서프라이즈나 조정 EPS는 제공하지 않습니다.
        </p>
        <p className="mt-1 text-xs leading-6 text-faint">
          발표일은 미국 날짜 기준이고, 장 마감 후 발표는 한국 시간으로 다음 날 아침입니다. 해외 기업(ADR)은 SEC 분기 공시가 없어 결과가 비어 있을 수 있습니다.
        </p>
      </Card>
    </div>
  );
}
