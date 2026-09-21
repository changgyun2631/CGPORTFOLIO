import type { CalendarEvent } from "@/lib/domain/types";
import { calendarSourceKey, formatCalendarValue, type CalendarResult } from "@/lib/domain/calendar-results";

const statusLabel: Record<CalendarResult["status"], string> = {
  pending: "발표 대기", available: "결과 확인", partial: "일부 결과 확인",
  unavailable: "결과 수집 대기", error: "수집 지연",
};

function timeLabel(value: string) {
  return new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

export function EventResults({ event, result, nowMs }: { event: CalendarEvent; result?: CalendarResult; nowMs: number }) {
  if (!event.resultSource) {
    return event.kind === "earnings" ? <p className="mt-2 text-xs text-muted">자동 수집 대상 기업·분기 설정이 필요합니다.</p> : null;
  }
  if (!result || result.sourceKey !== calendarSourceKey(event.resultSource)) {
    return <p className="mt-3 text-sm text-muted">공식 데이터 첫 수집 대기 · 대상 {event.resultSource.period}</p>;
  }
  const stale = result.lastSuccessAt && nowMs - Date.parse(result.lastSuccessAt) > 12 * 60 * 60 * 1000;
  return (
    <div className="mt-4 rounded-xl border border-line-strong bg-bg p-3 sm:p-4">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <span className="font-semibold text-text">{statusLabel[result.status]} · 대상 {result.period}</span>
        <a href={result.sourceUrl} target="_blank" rel="noreferrer" className="text-accent underline underline-offset-4">
          {result.provider === "bls" ? "BLS 공식 원천" : "SEC 기업 공시"} ↗
        </a>
      </div>
      <div className="mt-3 space-y-4">
        {result.metrics.map((row) => {
          const diff = row.actual !== null && row.previous !== null ? row.actual - row.previous : null;
          const revised = row.firstObserved !== null && row.actual !== null && Math.abs(row.firstObserved - row.actual) > 0.00001;
          return (
            <div key={row.id} className="border-t border-line pt-3">
              <p className="text-sm font-semibold">{row.label}</p>
              <div className="mt-2 grid grid-cols-3 gap-2 text-xs sm:gap-4">
                <div className="min-w-0">
                  <p className="text-muted">{result.provider === "bls" ? "전월" : "직전 분기"}</p>
                  <p title={row.previous === null ? undefined : `${row.previous.toLocaleString("ko-KR")} ${row.unit}`} className="tnum mt-1 break-words text-sm font-semibold">{formatCalendarValue(row.previous, row.unit)}</p>
                  {row.previousPeriod && <p className="mt-1 break-words text-faint">{row.previousPeriod}</p>}
                </div>
                <div className="min-w-0">
                  <p className="text-muted">이번 결과</p>
                  <p title={row.actual === null ? undefined : `${row.actual.toLocaleString("ko-KR")} ${row.unit}`} className="tnum mt-1 break-words text-sm font-bold text-text">{formatCalendarValue(row.actual, row.unit)}</p>
                  {row.actualPeriod && <p className="mt-1 break-words text-faint">{row.actualPeriod}</p>}
                </div>
                <div className="min-w-0">
                  <p className="text-muted">이전 대비 차이</p>
                  <p className="tnum mt-1 break-words text-sm font-semibold">{diff !== null && diff > 0 ? "+" : ""}{formatCalendarValue(diff, row.unit === "%" ? "%p" : row.unit)}</p>
                </div>
              </div>
              {row.yearAgo !== null && <p className="mt-2 text-xs text-muted">전년 동기: {formatCalendarValue(row.yearAgo, row.unit)} · {row.yearAgoPeriod}</p>}
              {revised && <p className="mt-2 text-xs text-muted">수정 반영 · 최초 수집값 {formatCalendarValue(row.firstObserved, row.unit)} ({row.firstObservedAt ? timeLabel(row.firstObservedAt) : ""})</p>}
              <p className="mt-2 break-words text-xs text-faint">{row.basis}</p>
            </div>
          );
        })}
      </div>
      <p className="mt-3 text-xs leading-6 text-muted">{result.message}</p>
      <p className="mt-1 text-xs text-faint">
        확인 시도 {timeLabel(result.checkedAt)} KST
        {result.lastSuccessAt ? ` · 원천 확인 ${timeLabel(result.lastSuccessAt)}` : " · 수집 성공 이력 없음"}
        {stale ? " · 갱신 지연: 이전 자료입니다" : ""}
      </p>
    </div>
  );
}
