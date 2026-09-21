import type { Metadata } from "next";
import Link from "next/link";

import { EventResults } from "@/components/calendar/event-results";
import { Card, Empty, PageTitle, Section } from "@/components/ui/primitives";
import { getCalendarEvents, getCalendarResults } from "@/lib/data/store";
import { seoulDate, type CalendarResult } from "@/lib/domain/calendar-results";
import type { CalendarEvent } from "@/lib/domain/types";

export const metadata: Metadata = { title: "캘린더" };
// 예약 스크립트가 바꾼 결과 파일을 새 요청에서 즉시 읽는다.
export const dynamic = "force-dynamic";

const kindLabel: Record<CalendarEvent["kind"], string> = { earnings: "실적", dividend: "배당", macro: "지표", personal: "개인" };
const kindTone: Record<CalendarEvent["kind"], string> = {
  earnings: "bg-accent-soft text-accent", dividend: "bg-up-soft text-up",
  macro: "bg-down-soft text-down", personal: "bg-surface-hover text-muted",
};

function dayLabel(date: string) {
  return new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "long", day: "numeric", weekday: "short" }).format(new Date(`${date}T00:00:00+09:00`));
}

function EventItem({ event, result, nowMs, past = false }: { event: CalendarEvent; result?: CalendarResult; nowMs: number; past?: boolean }) {
  return (
    <li className="px-4 py-4 sm:px-5">
      <div className="flex items-start gap-3">
        <span className={`shrink-0 rounded-md px-2 py-1 text-xs font-bold ${kindTone[event.kind]}`}>{kindLabel[event.kind]}</span>
        <div className="min-w-0 flex-1">
          {past && <p className="mb-1 text-xs text-muted">{event.date} · {dayLabel(event.date)}</p>}
          <p className="text-base font-semibold">{event.title}</p>
          {event.note && <p className="mt-1 text-sm leading-6 text-muted">{event.note}</p>}
        </div>
        {event.symbolId && <Link href={`/symbols/${encodeURIComponent(event.symbolId)}`} className="shrink-0 rounded border border-line-strong px-2 py-1 text-xs text-muted hover:text-text">{event.symbolId}</Link>}
      </div>
      <EventResults event={event} result={result} nowMs={nowMs} />
    </li>
  );
}

export default async function CalendarPage() {
  const [events, data] = await Promise.all([getCalendarEvents(), getCalendarResults()]);
  const now = new Date();
  const today = seoulDate(now);
  const upcoming = events.filter((e) => e.date >= today).sort((a, b) => a.date.localeCompare(b.date));
  const past = events.filter((e) => e.date < today).sort((a, b) => b.date.localeCompare(a.date));
  const grouped = upcoming.reduce<{ date: string; items: CalendarEvent[] }[]>((acc, event) => {
    const last = acc[acc.length - 1];
    if (last?.date === event.date) last.items.push(event);
    else acc.push({ date: event.date, items: [event] });
    return acc;
  }, []);

  return (
    <div className="space-y-8">
      <PageTitle title="캘린더" description="일정과 함께 이전 수치·발표 결과를 확인합니다." />
      <Card>
        <p className="text-sm font-semibold">무료 공식 데이터 · 기존 예약 작업에서 6시간마다 수집</p>
        <p className="mt-2 text-sm leading-6 text-muted">고용보고서는 BLS, 기업 실적은 SEC 공시를 확인합니다. 시장 예상치·조정 EPS는 제공하지 않습니다. 발표·공시 시점과 수집 시점은 다를 수 있으며, 화면을 새로고침하면 저장된 최신 결과가 표시됩니다.</p>
        <p className="mt-1 text-xs leading-6 text-faint">일정 날짜는 등록된 일정 기준이며 자동 검증하지 않습니다. 지원되지 않는 기업·지표는 결과가 표시되지 않을 수 있습니다.</p>
      </Card>
      {grouped.length === 0 ? <Empty title="예정된 일정이 없습니다" description="등록된 지난 일정의 결과는 아래에서 확인할 수 있습니다." /> : (
        <Section title="예정" description={`${upcoming.length}건 · 한국 시간 기준`}>
          <div className="space-y-4">
            {grouped.map((group) => (
              <Card key={group.date} padded={false}>
                <p className="border-b border-line px-4 py-3 text-sm font-semibold text-muted">{dayLabel(group.date)}</p>
                <ul className="divide-y divide-line">{group.items.map((event) => <EventItem key={event.id} event={event} result={data?.results[event.id]} nowMs={now.getTime()} />)}</ul>
              </Card>
            ))}
          </div>
        </Section>
      )}
      {past.length > 0 && (
        <Section title="지난 일정·발표 결과" description={`${past.length}건`}>
          <Card padded={false}><ul className="divide-y divide-line">{past.map((event) => <EventItem key={event.id} event={event} result={data?.results[event.id]} nowMs={now.getTime()} past />)}</ul></Card>
        </Section>
      )}
    </div>
  );
}
