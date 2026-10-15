"use client";

import Link from "next/link";
import { useState } from "react";

import { EventResults } from "@/components/calendar/event-results";
import type { CalendarResult } from "@/lib/domain/calendar-results";
import type { CalendarEvent } from "@/lib/domain/types";

/**
 * 월간 캘린더. 한 칸에 그날 일정을 적고, 날짜를 누르면 아래에 그날 일정과 발표
 * 결과가 뜬다. 월 이동은 클라이언트에서만 한다.
 */

const HEAD = ["월", "화", "수", "목", "금", "토", "일"];
const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];
const CHIPS_PER_CELL = 3;

const kindLabel: Record<CalendarEvent["kind"], string> = { earnings: "실적", dividend: "배당", macro: "지표", personal: "개인" };
const kindTone: Record<CalendarEvent["kind"], string> = {
  earnings: "bg-accent-soft text-accent",
  dividend: "bg-up-soft text-up",
  macro: "bg-down-soft text-down",
  personal: "bg-surface-hover text-muted",
};

const monthOf = (date: string) => date.slice(0, 7);
function shiftMonth(month: string, by: number) {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
const weekdayOf = (date: string) => new Date(`${date}T12:00:00Z`).getUTCDay();
const dayTitle = (date: string) => {
  const [, m, d] = date.split("-").map(Number);
  return `${m}월 ${d}일 ${WEEKDAYS[weekdayOf(date)]}요일`;
};

export function MonthCalendar({
  events,
  results,
  today,
  nowMs,
}: {
  events: CalendarEvent[];
  results: Record<string, CalendarResult>;
  today: string;
  nowMs: number;
}) {
  const [month, setMonth] = useState(monthOf(today));
  const [selected, setSelected] = useState(today);

  const eventsByDate = new Map<string, CalendarEvent[]>();
  for (const event of events) eventsByDate.set(event.date, [...(eventsByDate.get(event.date) ?? []), event]);

  const [year, mon] = month.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, mon, 0)).getUTCDate();
  const lead = (new Date(Date.UTC(year, mon - 1, 1)).getUTCDay() + 6) % 7;
  const monthEvents = events.filter((event) => event.date.startsWith(month));
  const countOf = (kind: CalendarEvent["kind"]) => monthEvents.filter((event) => event.kind === kind).length;
  const selectedEvents = eventsByDate.get(selected) ?? [];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1.5">
          <StepButton label="이전 달" onClick={() => setMonth(shiftMonth(month, -1))}>
            ◀
          </StepButton>
          <h2 className="tnum min-w-[8.5ch] text-center text-[22px] font-bold tracking-tight sm:text-[26px]">
            {year}년 {mon}월
          </h2>
          <StepButton label="다음 달" onClick={() => setMonth(shiftMonth(month, 1))}>
            ▶
          </StepButton>
          {month !== monthOf(today) ? (
            <button
              type="button"
              onClick={() => {
                setMonth(monthOf(today));
                setSelected(today);
              }}
              className="ml-1 rounded-lg border border-line px-2.5 py-1 text-xs text-muted transition-colors hover:border-line-strong hover:text-text"
            >
              이번 달
            </button>
          ) : null}
        </div>
        <p className="text-sm text-muted">
          이달 일정 {monthEvents.length}건
          {(["earnings", "macro", "dividend", "personal"] as const)
            .filter((kind) => countOf(kind) > 0)
            .map((kind) => ` · ${kindLabel[kind]} ${countOf(kind)}`)
            .join("")}
        </p>
      </div>

      <div>
        <div className="mb-2 grid grid-cols-7 gap-1 border-b border-line pb-2 sm:gap-2">
          {HEAD.map((label, i) => (
            <span key={label} className={`text-center text-[13px] font-semibold ${i < 5 ? "text-muted" : "text-faint"}`}>
              {label}
            </span>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1 sm:gap-2">
          {Array.from({ length: lead }, (_, i) => (
            <div key={`lead-${i}`} />
          ))}
          {Array.from({ length: lastDay }, (_, i) => {
            const date = `${month}-${String(i + 1).padStart(2, "0")}`;
            return (
              <DayCell
                key={date}
                d={i + 1}
                events={eventsByDate.get(date) ?? []}
                results={results}
                isToday={date === today}
                selected={date === selected}
                onSelect={() => setSelected(date)}
              />
            );
          })}
        </div>
      </div>

      <section aria-live="polite" className="rounded-2xl border border-line bg-bg-elevated p-5 sm:p-6">
        <h3 className="text-lg font-bold tracking-tight">{dayTitle(selected)}</h3>
        {selectedEvents.length === 0 ? (
          <p className="mt-2 text-sm text-faint">이날 등록된 일정이 없습니다.</p>
        ) : (
          <ul className="mt-1 divide-y divide-line">
            {selectedEvents.map((event) => (
              <EventRow key={event.id} event={event} result={results[event.id]} nowMs={nowMs} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/** 일정 한 줄 + 발표 결과. 날짜 상세와 페이지 아래 "발표 결과" 목록이 같이 쓴다. */
export function EventRow({ event, result, nowMs, showDate = false }: { event: CalendarEvent; result?: CalendarResult; nowMs: number; showDate?: boolean }) {
  return (
    <li className="py-3">
      <div className="flex items-start gap-3">
        <span className={`shrink-0 rounded-md px-2 py-1 text-xs font-bold ${kindTone[event.kind]}`}>{kindLabel[event.kind]}</span>
        <div className="min-w-0 flex-1">
          {showDate ? <p className="mb-0.5 text-xs text-muted">{dayTitle(event.date)}</p> : null}
          <p className="text-[15px] font-semibold">{event.title}</p>
          {event.note ? <p className="mt-1 text-sm leading-6 text-muted">{event.note}</p> : null}
        </div>
        {event.symbolId ? (
          <Link
            href={`/symbols/${encodeURIComponent(event.symbolId)}`}
            className="shrink-0 rounded border border-line-strong px-2 py-1 text-xs text-muted hover:text-text"
          >
            {event.symbolId}
          </Link>
        ) : null}
      </div>
      <EventResults event={event} result={result} nowMs={nowMs} />
    </li>
  );
}

function StepButton({ label, onClick, children }: { label: string; onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="grid size-8 place-items-center rounded-lg border border-line text-xs text-muted transition-colors hover:border-line-strong hover:text-text"
    >
      {children}
    </button>
  );
}

function DayCell({
  d,
  events,
  results,
  isToday,
  selected,
  onSelect,
}: {
  d: number;
  events: CalendarEvent[];
  results: Record<string, CalendarResult>;
  isToday: boolean;
  selected: boolean;
  onSelect: () => void;
}) {
  const extra = events.length - CHIPS_PER_CELL;
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      aria-label={`${d}일, 일정 ${events.length}건`}
      className={`flex min-h-[72px] flex-col gap-1 overflow-hidden rounded-lg border p-1.5 text-left transition-colors sm:min-h-[112px] sm:rounded-xl sm:p-2 ${
        selected ? "border-text ring-1 ring-inset ring-text" : "border-line hover:border-line-strong"
      } ${events.length > 0 ? "bg-surface" : ""}`}
    >
      <span
        className={`tnum self-start text-[12px] font-bold leading-5 sm:text-[13px] ${
          isToday ? "rounded-md bg-accent px-1.5 text-white" : "text-muted"
        }`}
      >
        {d}
      </span>
      {events.slice(0, CHIPS_PER_CELL).map((event) => (
        <span key={event.id} className={`truncate rounded-md px-1 text-[10px] font-medium leading-4 sm:text-[11px] ${kindTone[event.kind]}`}>
          {/* 결과가 들어온 일정은 ✓로 표시해 칸만 보고도 발표가 끝났는지 안다. */}
          {results[event.id]?.status === "available" ? "✓ " : ""}
          {event.symbolId ?? event.title}
        </span>
      ))}
      {extra > 0 ? <span className="text-[10px] leading-4 text-faint">+{extra}건</span> : null}
    </button>
  );
}
