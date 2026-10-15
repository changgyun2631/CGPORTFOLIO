import type { Metadata } from "next";

import { MonthCalendar } from "@/components/calendar/month-calendar";
import { Card, PageTitle } from "@/components/ui/primitives";
import { getCalendarEvents, getCalendarResults, getGoals } from "@/lib/data/store";
import { loadDailyGains, loadPortfolio } from "@/lib/data/views";
import { seoulDate } from "@/lib/domain/calendar-results";
import { goalCurve, targetOn } from "@/lib/domain/goals";
import { dateLabel, eok } from "@/lib/format";

export const metadata: Metadata = { title: "캘린더" };
// 예약 스크립트가 바꾼 결과 파일과 새로 저장한 목표를 새 요청에서 즉시 읽는다.
export const dynamic = "force-dynamic";

export default async function CalendarPage() {
  const [events, data, goals, { totals, snapshots }, dailyRows] = await Promise.all([
    getCalendarEvents(),
    getCalendarResults(),
    getGoals(),
    loadPortfolio(),
    loadDailyGains(),
  ]);
  const now = new Date();
  const today = seoulDate(now);

  // 목표 곡선의 출발점은 기록 첫날의 평가금액이다.
  const first = snapshots[0];
  const curve = goalCurve(first ? { date: dateLabel(first.at), amountKrw: first.totalKrw } : null, goals);
  const todayTarget = targetOn(curve, today);
  const gap = todayTarget === null ? null : totals.totalKrw - todayTarget;
  const nextGoal = goals.filter((g) => g.date >= today).sort((a, b) => a.date.localeCompare(b.date))[0];

  const days = dailyRows
    .filter((row) => row.dayGainKrw !== null)
    .map((row) => ({ date: row.date, dayGainKrw: row.dayGainKrw as number, dayPercent: row.dayPercent }));

  return (
    <div className="space-y-8">
      <PageTitle title="캘린더" description="일정·발표 결과, 날짜별 손익, 총 평가금액 목표를 한 달 단위로 봅니다." />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <SummaryCard label="현재 총 평가금액" value={eok(totals.totalKrw)} />
        <SummaryCard
          label="오늘 기준 목표"
          value={todayTarget === null ? "—" : eok(todayTarget)}
          sub={
            nextGoal
              ? `다음 목표 ${nextGoal.date} · ${eok(nextGoal.amountKrw)}`
              : goals.length === 0
                ? "아래 달력에서 날짜를 누르고 목표금액을 저장하세요"
                : "마지막 목표일이 지났습니다"
          }
        />
        <SummaryCard
          label={gap === null ? "목표 대비" : gap >= 0 ? "초과" : "부족"}
          value={gap === null ? "—" : `${gap >= 0 ? "+" : ""}${eok(gap)}`}
          tone={gap === null ? undefined : gap >= 0 ? "up" : "down"}
          sub={gap !== null && todayTarget ? `${gap >= 0 ? "+" : ""}${((gap / todayTarget) * 100).toFixed(2)}%` : undefined}
        />
      </div>

      <MonthCalendar
        events={events}
        results={data?.results ?? {}}
        days={days}
        goals={goals}
        curve={curve}
        today={today}
        nowMs={now.getTime()}
      />

      <Card>
        <p className="text-sm font-semibold">무료 공식 데이터 · 기존 예약 작업에서 6시간마다 수집</p>
        <p className="mt-2 text-sm leading-6 text-muted">고용보고서는 BLS, 기업 실적은 SEC 공시를 확인합니다. 시장 예상치·조정 EPS는 제공하지 않습니다. 발표·공시 시점과 수집 시점은 다를 수 있으며, 화면을 새로고침하면 저장된 최신 결과가 표시됩니다.</p>
        <p className="mt-1 text-xs leading-6 text-faint">일정 날짜는 등록된 일정 기준이며 자동 검증하지 않습니다. 지원되지 않는 기업·지표는 결과가 표시되지 않을 수 있습니다. 칸의 손익은 일별손익 화면과 같은 값(만 원 단위, 입출금 제외)입니다.</p>
      </Card>
    </div>
  );
}

function SummaryCard({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "up" | "down" }) {
  return (
    <div className="rounded-2xl border border-line-strong bg-surface p-5">
      <p className="text-sm font-semibold text-muted">{label}</p>
      <p className={`tnum mt-2 text-[24px] font-bold leading-tight tracking-tight ${tone === "up" ? "text-up" : tone === "down" ? "text-down" : "text-text"}`}>
        {value}
      </p>
      {sub ? <p className="mt-1.5 text-xs text-faint">{sub}</p> : null}
    </div>
  );
}
