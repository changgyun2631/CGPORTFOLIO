"use client";

import Link from "next/link";
import { useMemo, useRef, useState, type Ref } from "react";

import type { DailyGainRow } from "@/lib/domain/daily-gains";
import { money, moneySigned } from "@/lib/format";

/**
 * 손익 달력. 한 달을 펼쳐 칸 색의 진하기로 등락 크기를 보여주고, 날짜를 누르면
 * 옆 장부에 그날의 종목별 증감이 뜬다. 데이터는 한 번에 받아 두고 월 이동은
 * 클라이언트에서만 한다.
 */

type Day = DailyGainRow & { dayGainKrw: number };

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];
/** 달력 머리줄. 월요일 시작이고 주말 두 칸은 좁게 둔다 — 장이 쉬는 날이다. */
const HEAD = ["월", "화", "수", "목", "금", "토", "일"];
const GRID = "grid grid-cols-[repeat(5,minmax(0,1fr))_repeat(2,minmax(0,0.42fr))] gap-1 sm:gap-2";
/** 등락률 경계(%)와 단계별 색 농도(%). 색만 보고도 큰 날이 튀어나와야 한다. */
const HEAT_STEPS = [0.25, 0.75, 1.5, 3];
const HEAT_MIX = [8, 20, 36, 56, 78];
/** 장부에서 늘어난·줄어든 종목을 각각 몇 개까지 먼저 보여줄지 */
const TOP = 6;

const won = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 0 });
const weekdayOf = (date: string) => new Date(`${date}T12:00:00Z`).getUTCDay();
const isWeekend = (date: string) => [0, 6].includes(weekdayOf(date));
const tone = (value: number) => (value >= 0 ? "up" : "down");

/** 달력 칸용 만 원 단위. 5천 원 미만은 0으로 본다. */
function manwon(value: number) {
  const abs = Math.abs(value);
  if (abs < 5_000) return "0";
  return `${value > 0 ? "+" : "-"}${won.format(Math.round(abs / 10_000))}`;
}

function heatLevel(percent: number | null) {
  const p = Math.abs(percent ?? 0);
  const level = HEAT_STEPS.findIndex((step) => p < step);
  return level === -1 ? HEAT_STEPS.length : level;
}

/** `rows`는 최근 날짜가 먼저다. */
export function DailyCalendar({ rows }: { rows: DailyGainRow[] }) {
  const days = useMemo(() => rows.filter((row): row is Day => row.dayGainKrw !== null), [rows]);
  const byDate = useMemo(() => new Map(days.map((day) => [day.date, day])), [days]);
  const months = useMemo(() => [...new Set(days.map((day) => day.date.slice(0, 7)))].sort(), [days]);
  const latest = days.find((day) => !isWeekend(day.date)) ?? days[0];

  const [month, setMonth] = useState(latest.date.slice(0, 7));
  const [selected, setSelected] = useState(latest.date);
  const ledgerRef = useRef<HTMLElement>(null);

  const sumOf = (m: string) => days.filter((day) => day.date.startsWith(m)).reduce((sum, day) => sum + day.dayGainKrw, 0);

  const [year, mon] = month.split("-").map(Number);
  const inMonth = days.filter((day) => day.date.startsWith(month));
  const trading = inMonth.filter((day) => !isWeekend(day.date));
  // 주말 값(기록 출처 차이)도 합계에는 넣는다 — 그래야 한 달 동안 실제로 변한 이익과 맞는다.
  const monthSum = inMonth.reduce((sum, day) => sum + day.dayGainKrw, 0);
  const best = trading.reduce<Day | null>((a, day) => (!a || day.dayGainKrw > a.dayGainKrw ? day : a), null);
  const worst = trading.reduce<Day | null>((a, day) => (!a || day.dayGainKrw < a.dayGainKrw ? day : a), null);
  const monthIndex = months.indexOf(month);
  const goTo = (m: string) => months.includes(m) && setMonth(m);

  const select = (date: string) => {
    setSelected(date);
    // 좁은 화면에서는 장부가 달력 아래에 있어서, 누른 결과가 화면 밖에 뜬다.
    if (window.matchMedia("(max-width: 1023px)").matches) {
      const smooth = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      ledgerRef.current?.scrollIntoView({ behavior: smooth ? "smooth" : "auto", block: "start" });
    }
  };

  const recent = months.slice(-12);
  const recentSums = recent.map(sumOf);
  const stripMax = Math.max(1, ...recentSums.map(Math.abs));

  const lastDay = new Date(Date.UTC(year, mon, 0)).getUTCDate();
  const lead = (new Date(Date.UTC(year, mon - 1, 1)).getUTCDay() + 6) % 7;
  const newest = days[0].date;
  const selectedDay = byDate.get(selected) ?? latest;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-x-8 gap-y-4">
        <div className="flex items-center gap-1.5">
          <StepButton label="이전 달" disabled={monthIndex <= 0} onClick={() => goTo(months[monthIndex - 1])}>
            ◀
          </StepButton>
          <h2 className="tnum min-w-[8.5ch] text-center text-[22px] font-bold tracking-tight sm:text-[26px]">
            {year}년 {mon}월
          </h2>
          <StepButton label="다음 달" disabled={monthIndex >= months.length - 1} onClick={() => goTo(months[monthIndex + 1])}>
            ▶
          </StepButton>
        </div>

        <div className="flex items-stretch gap-0.5" role="group" aria-label="최근 12개월 손익">
          {recent.map((m, i) => {
            const height = Math.max(2, Math.round((Math.abs(recentSums[i]) / stripMax) * 20));
            const active = m === month;
            return (
              <button
                key={m}
                type="button"
                onClick={() => setMonth(m)}
                aria-pressed={active}
                aria-label={`${Number(m.slice(0, 4))}년 ${Number(m.slice(5))}월 ${moneySigned(recentSums[i])}`}
                title={`${Number(m.slice(5))}월 ${moneySigned(recentSums[i])}`}
                className={`grid h-[60px] w-[26px] grid-rows-[1fr_1fr_16px] justify-items-center rounded-md transition-colors sm:w-[30px] ${
                  active ? "bg-surface-hover" : "hover:bg-surface"
                }`}
              >
                <span
                  className={`w-2.5 rounded-sm ${recentSums[i] >= 0 ? "row-start-1 self-end bg-up" : "row-start-2 self-start bg-down"}`}
                  style={{ height }}
                />
                <span className={`row-start-3 text-[10px] leading-4 ${active ? "font-bold text-text" : "text-faint"}`}>
                  {Number(m.slice(5))}월
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <p className="flex flex-wrap items-baseline gap-x-2.5">
          <span className="text-[15px] text-muted">
            {mon}월 합계{month === newest.slice(0, 7) ? `(${Number(newest.slice(8))}일까지)` : ""}
          </span>
          <span className={`tnum text-[24px] font-bold tracking-tight ${monthSum >= 0 ? "text-up" : "text-down"}`}>
            {moneySigned(monthSum)}
          </span>
        </p>
        <p className="mt-0.5 text-sm text-muted">
          거래일 {trading.length}일 중 {trading.filter((d) => d.dayGainKrw > 0).length}일 늘고{" "}
          {trading.filter((d) => d.dayGainKrw < 0).length}일 줄었습니다.
        </p>
      </div>

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(360px,1fr)] lg:gap-8">
        <div>
          <p className="mb-1.5 text-right text-[11px] text-faint sm:hidden">달력 금액 단위는 만 원입니다</p>
          <div className={`${GRID} mb-2 border-b border-line pb-2`}>
            {HEAD.map((label, i) => (
              <span key={label} className={`text-center text-[13px] font-semibold ${i < 5 ? "text-muted" : "text-faint"}`}>
                {label}
              </span>
            ))}
          </div>
          <div className={GRID}>
            {Array.from({ length: lead }, (_, i) => (
              <div key={`lead-${i}`} />
            ))}
            {Array.from({ length: lastDay }, (_, i) => {
              const d = i + 1;
              const date = `${month}-${String(d).padStart(2, "0")}`;
              const day = byDate.get(date);
              if (isWeekend(date)) return <WeekendCell key={date} d={d} day={day} />;
              if (!day) return <EmptyCell key={date} d={d} future={date > newest} />;
              return (
                <DayCell
                  key={date}
                  d={d}
                  day={day}
                  mark={day === best ? "최고" : day === worst ? "최저" : null}
                  selected={day.date === selectedDay.date}
                  onSelect={() => select(day.date)}
                />
              );
            })}
          </div>
        </div>

        <Ledger ref={ledgerRef} key={selectedDay.date} day={selectedDay} />
      </div>
    </div>
  );
}

function StepButton({ label, disabled, onClick, children }: { label: string; disabled: boolean; onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="grid size-8 place-items-center rounded-lg border border-line text-xs text-muted transition-colors enabled:hover:border-line-strong enabled:hover:text-text disabled:opacity-35"
    >
      {children}
    </button>
  );
}

const CELL = "flex min-h-[64px] flex-col items-center justify-between rounded-lg px-1 py-1.5 text-center sm:min-h-[92px] sm:rounded-xl sm:py-2.5";

function DayCell({ d, day, mark, selected, onSelect }: { d: number; day: Day; mark: string | null; selected: boolean; onSelect: () => void }) {
  const level = heatLevel(day.dayPercent);
  const color = tone(day.dayGainKrw);
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      aria-label={`${d}일 ${moneySigned(day.dayGainKrw)}${mark ? `, 이달 ${mark}` : ""}`}
      style={{ background: `color-mix(in srgb, var(--${color}) ${HEAT_MIX[level]}%, var(--surface))` }}
      className={`${CELL} border transition-colors ${
        selected ? "border-text ring-1 ring-inset ring-text" : "border-transparent hover:border-line-strong"
      }`}
    >
      <span className="flex items-center gap-1 text-[11px] leading-4 text-muted sm:text-xs">
        {d}
        {mark ? <span className="font-bold text-text">{mark}</span> : null}
      </span>
      {/* 옅은 칸은 등락색 글자로, 진한 칸은 바탕색과 대비되게 본문색으로 쓴다. */}
      <span
        className={`tnum whitespace-nowrap text-[12px] font-bold leading-tight tracking-tight sm:text-[17px] ${
          level >= 2 ? "text-text" : color === "up" ? "text-up" : "text-down"
        }`}
      >
        {manwon(day.dayGainKrw)}
        <span className="max-sm:hidden">만</span>
      </span>
      <span className="tnum hidden text-[11px] leading-4 text-muted sm:block">
        {day.dayPercent === null ? "—" : `${day.dayPercent > 0 ? "+" : ""}${day.dayPercent.toFixed(2)}%`}
      </span>
    </button>
  );
}

function WeekendCell({ d, day }: { d: number; day: Day | undefined }) {
  const noise = day && Math.abs(day.dayGainKrw) >= 5_000;
  return (
    <div
      className={`${CELL} justify-start gap-1 text-faint`}
      title={noise ? "장이 쉬는 날입니다. 기록 출처가 바뀌며 생긴 차이로, 월 합계에는 들어갑니다." : undefined}
    >
      <span className="text-[11px] leading-4 sm:text-xs">{d}</span>
      {noise ? <span className="tnum hidden text-[10px] leading-4 sm:block">{manwon(day.dayGainKrw)}만</span> : null}
    </div>
  );
}

function EmptyCell({ d, future }: { d: number; future: boolean }) {
  return (
    <div className={`${CELL} ${future ? "" : "border border-dashed border-line"}`} title={future ? undefined : "기록이 없는 날"}>
      <span className={`text-[11px] leading-4 sm:text-xs ${future ? "text-line-strong" : "text-faint"}`}>{d}</span>
    </div>
  );
}

function Ledger({ day, ref }: { day: Day; ref: Ref<HTMLElement> }) {
  const [showAll, setShowAll] = useState(false);
  const [, m, d] = day.date.split("-").map(Number);
  const gainers = day.contributions.filter((c) => c.krw > 0).sort((a, b) => b.krw - a.krw);
  const losers = day.contributions.filter((c) => c.krw < 0).sort((a, b) => a.krw - b.krw);
  const max = Math.max(1, ...day.contributions.map((c) => Math.abs(c.krw)));
  const symbolSum = day.contributions.reduce((sum, c) => sum + c.krw, 0);
  const hidden = Math.max(gainers.length - TOP, 0) + Math.max(losers.length - TOP, 0);
  const shown = (list: typeof gainers) => (showAll ? list : list.slice(0, TOP));
  const restSum = (list: typeof gainers) => list.slice(TOP).reduce((sum, c) => sum + c.krw, 0);

  return (
    <section
      ref={ref}
      aria-live="polite"
      className="scroll-mt-24 rounded-2xl border border-line bg-bg-elevated p-5 sm:p-6 lg:sticky lg:top-24"
    >
      <h3 className="text-sm font-semibold text-muted">
        {m}월 {d}일 {WEEKDAYS[weekdayOf(day.date)]}요일
      </h3>
      <p className={`tnum mt-0.5 text-[32px] font-black leading-tight tracking-tight sm:text-[40px] ${day.dayGainKrw >= 0 ? "text-up" : "text-down"}`}>
        {moneySigned(day.dayGainKrw)}
      </p>
      <p className="mt-2 max-w-[46ch] text-[13px] leading-6 text-muted">
        {day.dayPercent !== null ? `전날보다 자산이 ${Math.abs(day.dayPercent).toFixed(2)}% ${day.dayGainKrw >= 0 ? "늘었습니다" : "줄었습니다"}. ` : ""}
        이날 평가금액은 {money(day.totalKrw)}
        {day.gainKrw !== null
          ? `으로, 넣은 원금보다 ${money(Math.abs(day.gainKrw))} ${day.gainKrw >= 0 ? "많습니다" : "적습니다"}.`
          : "입니다."}
      </p>

      {day.contributions.length === 0 ? (
        <p className="mt-4 border-t border-line pt-4 text-[13px] text-faint">
          종가가 바뀌지 않았거나 종가를 알 수 없어 종목별로 나눌 수 없는 날입니다.
        </p>
      ) : (
        <ul className="mt-4 grid gap-1.5 border-t border-line pt-4">
          {shown(gainers).map((c) => (
            <Bar key={c.symbolId} symbolId={c.symbolId} krw={c.krw} max={max} />
          ))}
          {!showAll && gainers.length > TOP ? <RestLine count={gainers.length - TOP} krw={restSum(gainers)} /> : null}
          {gainers.length > 0 && losers.length > 0 ? <li aria-hidden className="h-2" /> : null}
          {shown(losers).map((c) => (
            <Bar key={c.symbolId} symbolId={c.symbolId} krw={c.krw} max={max} />
          ))}
          {!showAll && losers.length > TOP ? <RestLine count={losers.length - TOP} krw={restSum(losers)} /> : null}
        </ul>
      )}
      {hidden > 0 ? (
        <button type="button" onClick={() => setShowAll((v) => !v)} className="mt-2 text-xs font-medium text-accent hover:underline">
          {showAll ? "상위 종목만 보기" : `${hidden}종목 더 보기`}
        </button>
      ) : null}

      <dl className="tnum mt-4 grid grid-cols-[1fr_auto] gap-y-1 border-t border-line pt-3 text-xs">
        <dt className="text-faint">
          종목 합계 (늘어난 {gainers.length}종목, 줄어든 {losers.length}종목)
        </dt>
        <dd className="text-right text-muted">{moneySigned(symbolSum)}</dd>
        <dt className="text-faint" title="배당, 예수금 환율 변동, 증권사 예탁자산과 이 대시보드 계산의 차이">
          기타 (배당·환율·계산 차이)
        </dt>
        <dd className="text-right text-muted">{moneySigned(day.otherKrw)}</dd>
        <dt className="font-semibold text-text">이날 손익</dt>
        <dd className="text-right font-bold text-text">{moneySigned(day.dayGainKrw)}</dd>
      </dl>
    </section>
  );
}

function Bar({ symbolId, krw, max }: { symbolId: string; krw: number; max: number }) {
  const width = `${Math.max((Math.abs(krw) / max) * 50, 0.5)}%`;
  return (
    <li className="grid grid-cols-[64px_1fr_104px] items-center gap-2.5 text-[12px]">
      <Link href={`/symbols/${encodeURIComponent(symbolId)}`} className="truncate font-bold tracking-tight hover:underline">
        {symbolId}
      </Link>
      <span className="relative h-2.5">
        <span aria-hidden className="absolute inset-y-[-3px] left-1/2 w-px bg-line-strong" />
        <span
          className={`absolute inset-y-0 rounded-sm ${krw >= 0 ? "left-1/2 bg-up" : "right-1/2 bg-down"}`}
          style={{ width }}
        />
      </span>
      <span className={`tnum text-right font-semibold ${krw >= 0 ? "text-up" : "text-down"}`}>{moneySigned(krw)}</span>
    </li>
  );
}

function RestLine({ count, krw }: { count: number; krw: number }) {
  return (
    <li className="grid grid-cols-[64px_1fr_104px] items-center gap-2.5 text-[12px] text-faint">
      <span>외 {count}종목</span>
      <span />
      <span className="tnum text-right">{moneySigned(krw)}</span>
    </li>
  );
}
