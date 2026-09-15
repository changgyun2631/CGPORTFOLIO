import type { Metadata } from "next";
import Link from "next/link";

import { Card, Empty, PageTitle, Section } from "@/components/ui/primitives";
import { getCalendarEvents } from "@/lib/data/store";
import type { CalendarEvent } from "@/lib/domain/types";

export const metadata: Metadata = { title: "캘린더" };

const kindLabel: Record<CalendarEvent["kind"], string> = {
  earnings: "실적",
  dividend: "배당",
  macro: "지표",
  personal: "개인",
};

const kindTone: Record<CalendarEvent["kind"], string> = {
  earnings: "bg-accent-soft text-accent",
  dividend: "bg-up-soft text-up",
  macro: "bg-down-soft text-down",
  personal: "bg-surface-hover text-muted",
};

/** YYYY-MM-DD 를 "9월 16일 (수)" 로. */
function dayLabel(date: string) {
  const d = new Date(`${date}T00:00:00+09:00`);
  const weekday = ["일", "월", "화", "수", "목", "금", "토"][d.getDay()];
  return `${d.getMonth() + 1}월 ${d.getDate()}일 (${weekday})`;
}

export default async function CalendarPage() {
  const events = await getCalendarEvents();
  const today = new Date().toISOString().slice(0, 10);

  const upcoming = events.filter((e) => e.date >= today).sort((a, b) => a.date.localeCompare(b.date));
  const past = events.filter((e) => e.date < today).sort((a, b) => b.date.localeCompare(a.date));

  /** 같은 날짜끼리 묶는다. */
  const grouped = upcoming.reduce<{ date: string; items: CalendarEvent[] }[]>((acc, event) => {
    const last = acc[acc.length - 1];
    if (last && last.date === event.date) last.items.push(event);
    else acc.push({ date: event.date, items: [event] });
    return acc;
  }, []);

  return (
    <div className="space-y-8">
      <PageTitle title="캘린더" description="실적·배당·지표·개인 일정을 한 줄로 봅니다." />

      {grouped.length === 0 ? (
        <Empty title="예정된 일정이 없습니다" description="data/calendar.json 에 일정을 추가하세요." />
      ) : (
        <Section title="예정" description={`${upcoming.length}건`}>
          <div className="space-y-3">
            {grouped.map((group) => (
              <Card key={group.date} padded={false}>
                <p className="border-b border-line px-4 py-2.5 text-[12px] font-semibold text-muted">{dayLabel(group.date)}</p>
                <ul className="divide-y divide-line">
                  {group.items.map((event) => (
                    <li key={event.id} className="flex items-center gap-3 px-4 py-3">
                      <span className={`shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-bold ${kindTone[event.kind]}`}>
                        {kindLabel[event.kind]}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-[13px] font-medium">{event.title}</p>
                        {event.note ? <p className="mt-0.5 text-[11px] text-faint">{event.note}</p> : null}
                      </div>
                      {event.symbolId ? (
                        <Link
                          href={`/symbols/${encodeURIComponent(event.symbolId)}`}
                          className="shrink-0 rounded border border-line px-1.5 py-0.5 text-[10px] text-muted hover:border-line-strong hover:text-text"
                        >
                          {event.symbolId}
                        </Link>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </Card>
            ))}
          </div>
        </Section>
      )}

      {past.length > 0 ? (
        <Section title="지난 일정" description={`${past.length}건`}>
          <Card padded={false}>
            <ul className="divide-y divide-line">
              {past.slice(0, 10).map((event) => (
                <li key={event.id} className="flex items-center gap-3 px-4 py-2.5 text-[12px] text-muted">
                  <span className="tnum shrink-0 text-faint">{event.date}</span>
                  <span className="min-w-0 flex-1 truncate">{event.title}</span>
                  <span className="shrink-0 text-[10px] text-faint">{kindLabel[event.kind]}</span>
                </li>
              ))}
            </ul>
          </Card>
        </Section>
      ) : null}
    </div>
  );
}
