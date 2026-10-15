"use client";

import Link from "next/link";
import { useActionState, useState, useTransition } from "react";

import { EventResults } from "@/components/calendar/event-results";
import type { CalendarResult } from "@/lib/domain/calendar-results";
import { targetOn, type AssetGoal } from "@/lib/domain/goals";
import type { CalendarEvent } from "@/lib/domain/types";
import { deleteGoal, saveGoal } from "@/lib/goals-actions";
import { eok, moneySigned } from "@/lib/format";

/**
 * 월간 캘린더. 한 칸에 그날 일정·손익·목표를 같이 적고, 날짜를 누르면 아래에
 * 그날 상세(발표 결과, 목표 저장)가 뜬다. 월 이동은 클라이언트에서만 한다.
 */

export type CalendarDay = { date: string; dayGainKrw: number; dayPercent: number | null };

const HEAD = ["월", "화", "수", "목", "금", "토", "일"];
const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];
const CHIPS_PER_CELL = 2;

const kindLabel: Record<CalendarEvent["kind"], string> = { earnings: "실적", dividend: "배당", macro: "지표", personal: "개인" };
const kindTone: Record<CalendarEvent["kind"], string> = {
  earnings: "bg-accent-soft text-accent",
  dividend: "bg-up-soft text-up",
  macro: "bg-down-soft text-down",
  personal: "bg-surface-hover text-muted",
};

const won = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 0 });

/** 칸 안 손익은 만 원 단위. */
function manwon(value: number) {
  if (Math.abs(value) < 5_000) return "0";
  return `${value > 0 ? "+" : "-"}${won.format(Math.round(Math.abs(value) / 10_000))}만`;
}

const monthOf = (date: string) => date.slice(0, 7);
function shiftMonth(month: string, by: number) {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
const weekdayOf = (date: string) => new Date(`${date}T12:00:00Z`).getUTCDay();

export function MonthCalendar({
  events,
  results,
  days,
  goals,
  curve,
  today,
  nowMs,
}: {
  events: CalendarEvent[];
  results: Record<string, CalendarResult>;
  days: CalendarDay[];
  goals: AssetGoal[];
  curve: AssetGoal[];
  today: string;
  nowMs: number;
}) {
  const [month, setMonth] = useState(monthOf(today));
  const [selected, setSelected] = useState(today);

  const eventsByDate = new Map<string, CalendarEvent[]>();
  for (const event of events) eventsByDate.set(event.date, [...(eventsByDate.get(event.date) ?? []), event]);
  const dayByDate = new Map(days.map((day) => [day.date, day]));
  const goalByDate = new Map(goals.map((goal) => [goal.date, goal]));

  const [year, mon] = month.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, mon, 0)).getUTCDate();
  const lead = (new Date(Date.UTC(year, mon - 1, 1)).getUTCDay() + 6) % 7;
  const monthEvents = events.filter((event) => event.date.startsWith(month));
  const countOf = (kind: CalendarEvent["kind"]) => monthEvents.filter((event) => event.kind === kind).length;

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
          {(["macro", "earnings", "dividend", "personal"] as const)
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
                day={dayByDate.get(date)}
                goal={goalByDate.get(date)}
                isToday={date === today}
                selected={date === selected}
                onSelect={() => setSelected(date)}
              />
            );
          })}
        </div>
      </div>

      <DayDetail
        key={selected}
        date={selected}
        events={eventsByDate.get(selected) ?? []}
        results={results}
        day={dayByDate.get(selected)}
        goal={goalByDate.get(selected)}
        target={targetOn(curve, selected)}
        nowMs={nowMs}
      />
    </div>
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
  day,
  goal,
  isToday,
  selected,
  onSelect,
}: {
  d: number;
  events: CalendarEvent[];
  day?: CalendarDay;
  goal?: AssetGoal;
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
      aria-label={`${d}일, 일정 ${events.length}건${day ? `, 손익 ${moneySigned(day.dayGainKrw)}` : ""}${goal ? ", 목표 있음" : ""}`}
      className={`flex min-h-[72px] flex-col gap-1 overflow-hidden rounded-lg border p-1.5 text-left transition-colors sm:min-h-[104px] sm:rounded-xl sm:p-2 ${
        selected ? "border-text ring-1 ring-inset ring-text" : "border-line hover:border-line-strong"
      } ${events.length > 0 || goal ? "bg-surface" : ""}`}
    >
      {/* 좁은 화면에서는 날짜 옆에 손익이 들어갈 폭이 없어 아래로 내린다. */}
      <span className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-1">
        <span
          className={`tnum self-start text-[12px] font-bold leading-5 sm:text-[13px] ${
            isToday ? "rounded-md bg-accent px-1.5 text-white" : "text-muted"
          }`}
        >
          {d}
        </span>
        {day ? (
          <span className={`tnum truncate text-[9px] font-semibold sm:text-[11px] ${day.dayGainKrw >= 0 ? "text-up" : "text-down"}`}>
            {manwon(day.dayGainKrw)}
          </span>
        ) : null}
      </span>
      {goal ? (
        <span className="truncate rounded-md border border-accent/50 px-1 text-[10px] font-semibold leading-4 text-accent sm:text-[11px]">
          목표 {eok(goal.amountKrw)}
        </span>
      ) : null}
      {events.slice(0, CHIPS_PER_CELL).map((event) => (
        <span key={event.id} className={`truncate rounded-md px-1 text-[10px] font-medium leading-4 sm:text-[11px] ${kindTone[event.kind]}`}>
          <span className="font-bold max-sm:hidden">{kindLabel[event.kind]} </span>
          {event.symbolId ?? event.title}
        </span>
      ))}
      {extra > 0 ? <span className="text-[10px] leading-4 text-faint">+{extra}건</span> : null}
    </button>
  );
}

function DayDetail({
  date,
  events,
  results,
  day,
  goal,
  target,
  nowMs,
}: {
  date: string;
  events: CalendarEvent[];
  results: Record<string, CalendarResult>;
  day?: CalendarDay;
  goal?: AssetGoal;
  target: number | null;
  nowMs: number;
}) {
  const [, m, d] = date.split("-").map(Number);
  return (
    <section aria-live="polite" className="rounded-2xl border border-line bg-bg-elevated p-5 sm:p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <h3 className="text-lg font-bold tracking-tight">
          {m}월 {d}일 {WEEKDAYS[weekdayOf(date)]}요일
        </h3>
        {day ? (
          <Link href="/daily" className="text-sm text-muted hover:text-text">
            이날 손익{" "}
            <span className={`tnum font-bold ${day.dayGainKrw >= 0 ? "text-up" : "text-down"}`}>{moneySigned(day.dayGainKrw)}</span>
            {day.dayPercent !== null ? (
              <span className="tnum ml-1 text-faint">
                ({day.dayPercent > 0 ? "+" : ""}
                {day.dayPercent.toFixed(2)}%)
              </span>
            ) : null}{" "}
            →
          </Link>
        ) : null}
      </div>

      <div className="mt-4 grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div>
          <p className="text-xs font-semibold text-faint">일정</p>
          {events.length === 0 ? (
            <p className="mt-2 text-sm text-faint">이날 등록된 일정이 없습니다.</p>
          ) : (
            <ul className="mt-1 divide-y divide-line">
              {events.map((event) => (
                <li key={event.id} className="py-3">
                  <div className="flex items-start gap-3">
                    <span className={`shrink-0 rounded-md px-2 py-1 text-xs font-bold ${kindTone[event.kind]}`}>{kindLabel[event.kind]}</span>
                    <div className="min-w-0 flex-1">
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
                  <EventResults event={event} result={results[event.id]} nowMs={nowMs} />
                </li>
              ))}
            </ul>
          )}
        </div>

        <GoalPanel date={date} goal={goal} target={target} />
      </div>
    </section>
  );
}

function GoalPanel({ date, goal, target }: { date: string; goal?: AssetGoal; target: number | null }) {
  const [state, formAction, saving] = useActionState(saveGoal, null);
  const [deleting, startDelete] = useTransition();
  const [deleteMessage, setDeleteMessage] = useState<string | null>(null);

  return (
    <div className="rounded-xl border border-line p-4">
      <p className="text-xs font-semibold text-faint">자산 목표</p>
      {goal ? (
        <div className="mt-1 flex items-baseline justify-between gap-3">
          <p className="tnum text-[20px] font-bold text-accent">{eok(goal.amountKrw)}</p>
          <button
            type="button"
            disabled={deleting}
            onClick={() =>
              startDelete(async () => {
                const result = await deleteGoal(date);
                setDeleteMessage(result?.message ?? null);
              })
            }
            className="text-xs text-muted hover:text-down disabled:opacity-50"
          >
            목표 지우기
          </button>
        </div>
      ) : target !== null ? (
        <p className="mt-1 text-sm text-muted">
          이날 기준 목표 <span className="tnum font-bold text-text">{eok(target)}</span>
        </p>
      ) : (
        <p className="mt-1 text-sm text-faint">이날은 목표가 없습니다.</p>
      )}

      <form action={formAction} className="mt-3 grid grid-cols-[1fr_auto] items-end gap-2">
        <input type="hidden" name="date" value={date} />
        <label className="grid gap-1 text-xs text-muted">
          이날까지 목표금액 (억 원)
          <input
            name="amountEok"
            type="number"
            inputMode="decimal"
            step="0.0001"
            min="0"
            required
            defaultValue={goal ? goal.amountKrw / 100_000_000 : undefined}
            placeholder="예: 12.5"
            className="tnum rounded-lg border border-line bg-surface px-2.5 py-1.5 text-sm text-text"
          />
        </label>
        <button
          type="submit"
          disabled={saving}
          className="rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
        >
          {goal ? "바꾸기" : "저장"}
        </button>
      </form>
      {state || deleteMessage ? (
        <p className={`mt-2 text-xs ${state && !state.ok ? "text-down" : "text-muted"}`}>{deleteMessage ?? state?.message}</p>
      ) : null}
      <p className="mt-3 text-[11px] leading-5 text-faint">
        목표 사이의 날짜는 기록 첫날부터 목표까지 매일 같은 비율로 자란다고 보고 계산합니다.
      </p>
    </div>
  );
}
