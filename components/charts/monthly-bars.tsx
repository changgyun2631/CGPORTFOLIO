import { money } from "@/lib/format";

/**
 * 월별 막대. 배당 화면과 대시보드의 월간 배당 섹션에서 쓴다.
 *
 * 금액 라벨은 absolute로 띄운다. 흐름 안에 두면 opacity로 숨겨도 자리를
 * 차지해서, 좁은 화면에서 12칸의 최소 폭이 화면을 넘어간다.
 */
export function MonthlyBars({
  months,
  height = 160,
}: {
  months: { month: string; totalKrw: number }[];
  height?: number;
}) {
  const max = Math.max(...months.map((m) => m.totalKrw), 1);

  return (
    <div className="flex items-end gap-1 sm:gap-2" style={{ height }}>
      {months.map((m) => {
        const ratio = m.totalKrw / max;
        const filled = m.totalKrw > 0;
        return (
          <div key={m.month} className="group relative flex h-full min-w-0 flex-1 flex-col justify-end gap-1.5">
            {filled ? (
              <span className="pointer-events-none absolute -top-1 left-1/2 z-10 -translate-x-1/2 whitespace-nowrap rounded border border-line bg-bg-elevated px-1.5 py-0.5 text-[10px] font-medium opacity-0 transition-opacity group-hover:opacity-100">
                {money(m.totalKrw)}
              </span>
            ) : null}
            <div
              className={`w-full rounded-t-md ${filled ? "bg-accent" : "bg-line"}`}
              style={{ height: `${Math.max(ratio * 100, filled ? 4 : 2)}%` }}
              title={`${m.month} · ${money(m.totalKrw)}`}
            />
            <span className="text-center text-[10px] text-faint">{Number(m.month.slice(5, 7))}</span>
          </div>
        );
      })}
    </div>
  );
}
