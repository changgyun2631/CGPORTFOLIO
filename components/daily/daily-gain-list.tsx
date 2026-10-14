"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { Card, Delta, Stat } from "@/components/ui/primitives";
import type { DailyGainRow } from "@/lib/domain/daily-gains";
import { money, moneySigned } from "@/lib/format";

/**
 * 일별 평가손익 목록. 기간 버튼은 클라이언트에서 거른다 — 전체를 한 번 받아 두면
 * 버튼을 눌러도 서버를 다시 다녀오지 않는다(대시보드 차트와 같은 방식).
 */

const RANGES = [
  { key: "1m", label: "1개월", days: 30 },
  { key: "3m", label: "3개월", days: 90 },
  { key: "6m", label: "6개월", days: 180 },
  { key: "1y", label: "1년", days: 365 },
  { key: "all", label: "전체", days: null },
] as const;

type RangeKey = (typeof RANGES)[number]["key"];

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];
const weekdayOf = (date: string) => WEEKDAYS[new Date(`${date}T12:00:00Z`).getUTCDay()];

/** `rows`는 최근 날짜가 먼저다. */
export function DailyGainList({ rows }: { rows: DailyGainRow[] }) {
  const [range, setRange] = useState<RangeKey>("1m");
  const [open, setOpen] = useState<string | null>(null);

  const visible = useMemo(() => {
    const days = RANGES.find((r) => r.key === range)?.days;
    if (!days || rows.length === 0) return rows;
    const cutoff = new Date(`${rows[0].date}T00:00:00Z`);
    cutoff.setUTCDate(cutoff.getUTCDate() - days);
    const from = cutoff.toISOString().slice(0, 10);
    return rows.filter((row) => row.date >= from);
  }, [rows, range]);

  const summary = useMemo(() => {
    const counted = visible.filter((row) => row.dayGainKrw !== null);
    const gains = counted.map((row) => row.dayGainKrw as number);
    return {
      total: gains.reduce((sum, g) => sum + g, 0),
      up: gains.filter((g) => g > 0).length,
      down: gains.filter((g) => g < 0).length,
      best: counted.reduce<DailyGainRow | null>((a, row) => (!a || (row.dayGainKrw as number) > (a.dayGainKrw as number) ? row : a), null),
      worst: counted.reduce<DailyGainRow | null>((a, row) => (!a || (row.dayGainKrw as number) < (a.dayGainKrw as number) ? row : a), null),
    };
  }, [visible]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-1.5">
        {RANGES.map((r) => (
          <button
            key={r.key}
            type="button"
            onClick={() => {
              setRange(r.key);
              setOpen(null);
            }}
            aria-pressed={range === r.key}
            className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${
              range === r.key ? "bg-accent text-white" : "border border-line text-muted hover:border-line-strong hover:text-text"
            }`}
          >
            {r.label}
          </button>
        ))}
        <span className="ml-auto text-xs text-faint">{visible.length}일</span>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="기간 손익 합계"
          value={moneySigned(summary.total)}
          tone={summary.total >= 0 ? "up" : "down"}
          sub="일 손익을 모두 더한 값"
        />
        <Stat label="상승 / 하락일" value={`${summary.up} / ${summary.down}`} sub={`${summary.up + summary.down}일 중`} />
        <Stat
          label="가장 많이 늘어난 날"
          value={summary.best ? moneySigned(summary.best.dayGainKrw) : "—"}
          tone={summary.best && (summary.best.dayGainKrw ?? 0) >= 0 ? "up" : "down"}
          sub={summary.best?.date}
        />
        <Stat
          label="가장 많이 줄어든 날"
          value={summary.worst ? moneySigned(summary.worst.dayGainKrw) : "—"}
          tone={summary.worst && (summary.worst.dayGainKrw ?? 0) >= 0 ? "up" : "down"}
          sub={summary.worst?.date}
        />
      </div>

      <Card padded={false}>
        <ul className="divide-y divide-line">
          <li className="flex items-center gap-3 px-4 py-2 text-[11px] text-faint">
            <span className="w-[96px] shrink-0">날짜</span>
            <span className="min-w-0 flex-1 text-right">일 손익</span>
            <span className="hidden w-[130px] shrink-0 text-right sm:block">총 평가금액</span>
            <span className="hidden w-[130px] shrink-0 text-right md:block">원금 대비 이익</span>
            <span className="w-3 shrink-0" aria-hidden />
          </li>
          {visible.map((row) => (
            <DayRow key={row.date} row={row} open={open === row.date} onToggle={() => setOpen(open === row.date ? null : row.date)} />
          ))}
        </ul>
      </Card>
    </div>
  );
}

function DayRow({ row, open, onToggle }: { row: DailyGainRow; open: boolean; onToggle: () => void }) {
  const panelId = `daily-${row.date}`;
  const expandable = row.contributions.length > 0 || (row.otherKrw !== null && row.otherKrw !== 0);
  const maxAbs = Math.max(1, ...row.contributions.map((c) => Math.abs(c.krw)), Math.abs(row.otherKrw ?? 0));

  return (
    <li>
      <button
        type="button"
        onClick={onToggle}
        disabled={!expandable}
        aria-expanded={expandable ? open : undefined}
        aria-controls={expandable ? panelId : undefined}
        className="flex w-full items-center gap-3 px-4 py-3 text-left text-[13px] transition-colors enabled:hover:bg-surface-hover"
      >
        <span className="tnum w-[96px] shrink-0 font-semibold tracking-tight">
          {row.date.slice(2)}
          <span className="ml-1.5 text-[11px] font-medium text-faint">{weekdayOf(row.date)}</span>
        </span>
        <span className="min-w-0 flex-1 text-right">
          {row.dayGainKrw === null ? <span className="text-faint">—</span> : <Delta amount={row.dayGainKrw} percent={row.dayPercent} className="font-semibold" />}
        </span>
        <span className="tnum hidden w-[130px] shrink-0 text-right text-muted sm:block">{money(row.totalKrw)}</span>
        <span className="hidden w-[130px] shrink-0 text-right md:block">
          {row.gainKrw === null ? <span className="text-faint">—</span> : <Delta amount={row.gainKrw} className="text-muted" />}
        </span>
        <span className={`w-3 shrink-0 text-center text-[10px] text-faint transition-transform ${open ? "rotate-90" : ""}`} aria-hidden>
          {expandable ? "▶" : ""}
        </span>
      </button>

      {open && expandable ? (
        <ul id={panelId} className="space-y-1.5 border-t border-line bg-bg-elevated px-4 py-3">
          {row.contributions.map((c) => (
            <ContributionLine key={c.symbolId} label={c.symbolId} href={`/symbols/${encodeURIComponent(c.symbolId)}`} krw={c.krw} maxAbs={maxAbs} />
          ))}
          {row.otherKrw !== null && row.otherKrw !== 0 ? (
            <ContributionLine label="기타 (배당·예수금 환율·계산 차이)" krw={row.otherKrw} maxAbs={maxAbs} muted />
          ) : null}
        </ul>
      ) : null}
    </li>
  );
}

function ContributionLine({ label, href, krw, maxAbs, muted = false }: { label: string; href?: string; krw: number; maxAbs: number; muted?: boolean }) {
  const width = Math.max((Math.abs(krw) / maxAbs) * 100, 1);
  return (
    <li className="flex items-center gap-3 text-[12px]">
      {href ? (
        <Link href={href} className="w-[120px] shrink-0 truncate font-bold tracking-tight hover:underline">
          {label}
        </Link>
      ) : (
        <span className="w-[120px] shrink-0 text-[11px] leading-4 text-faint">{label}</span>
      )}
      <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-surface">
        <span className={`block h-full rounded-full ${krw >= 0 ? "bg-up" : "bg-down"} ${muted ? "opacity-40" : ""}`} style={{ width: `${width}%` }} />
      </span>
      <Delta amount={krw} className="w-[110px] shrink-0 justify-end font-semibold" />
    </li>
  );
}
