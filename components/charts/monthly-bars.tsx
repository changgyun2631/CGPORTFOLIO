import { colorFor } from "@/components/dashboard/palette";
import { money } from "@/lib/format";

/**
 * 월별 막대. 배당 화면과 대시보드의 월간 배당 섹션에서 쓴다.
 *
 * 금액 라벨은 absolute로 띄운다. 흐름 안에 두면 opacity로 숨겨도 자리를
 * 차지해서, 좁은 화면에서 12칸의 최소 폭이 화면을 넘어간다.
 *
 * `symbolOrder`를 주면 종목별로 색을 나눠 쌓는다(같은 종목은 달이 바뀌어도
 * 같은 색). 안 주면 기존처럼 단색 막대다 — 배당 이력이 한 종목뿐이면
 * 나눠봐야 의미가 없어서 호출하는 쪽에서 선택하게 뒀다.
 */
export function MonthlyBars({
  months,
  height = 160,
  symbolOrder,
}: {
  months: { month: string; totalKrw: number; bySymbol?: { symbolId: string; name: string; amountKrw: number }[] }[];
  height?: number;
  symbolOrder?: string[];
}) {
  const max = Math.max(...months.map((m) => m.totalKrw), 1);
  const colorIndex = new Map((symbolOrder ?? []).map((id, i) => [id, i]));

  return (
    <div className="flex items-end gap-1 sm:gap-2" style={{ height }}>
      {months.map((m) => {
        const ratio = m.totalKrw / max;
        const filled = m.totalKrw > 0;
        const segments = symbolOrder && m.bySymbol && m.bySymbol.length > 0 ? m.bySymbol : null;

        return (
          <div key={m.month} className="group relative flex h-full min-w-0 flex-1 flex-col justify-end gap-1.5">
            {filled ? (
              <div className="pointer-events-none absolute -top-1 left-1/2 z-10 -translate-x-1/2 whitespace-nowrap rounded border border-line bg-bg-elevated px-1.5 py-1 text-[10px] font-medium opacity-0 shadow-lg transition-opacity group-hover:opacity-100">
                {segments ? (
                  <ul className="space-y-0.5">
                    {segments.map((s) => (
                      <li key={s.symbolId} className="flex items-center gap-1.5">
                        <span
                          className="h-1.5 w-1.5 shrink-0 rounded-full"
                          style={{ background: colorFor(colorIndex.get(s.symbolId) ?? 0) }}
                        />
                        <span className="font-bold">{s.symbolId}</span>
                        <span className="tnum">{money(s.amountKrw)}</span>
                      </li>
                    ))}
                    <li className="mt-0.5 border-t border-line pt-0.5 font-bold">{money(m.totalKrw)}</li>
                  </ul>
                ) : (
                  money(m.totalKrw)
                )}
              </div>
            ) : null}

            {segments ? (
              <div
                className="flex w-full flex-col-reverse overflow-hidden rounded-t-md"
                style={{ height: `${Math.max(ratio * 100, 4)}%` }}
              >
                {segments.map((s) => (
                  <div
                    key={s.symbolId}
                    style={{
                      height: `${(s.amountKrw / m.totalKrw) * 100}%`,
                      background: colorFor(colorIndex.get(s.symbolId) ?? 0),
                    }}
                  />
                ))}
              </div>
            ) : (
              <div
                className={`w-full rounded-t-md ${filled ? "bg-accent" : "bg-line"}`}
                style={{ height: `${Math.max(ratio * 100, filled ? 4 : 2)}%` }}
                title={`${m.month} · ${money(m.totalKrw)}`}
              />
            )}
            <span className="text-center text-[10px] text-faint">{Number(m.month.slice(5, 7))}</span>
          </div>
        );
      })}
    </div>
  );
}
