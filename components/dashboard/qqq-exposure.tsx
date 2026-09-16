import type { ExposureSummary } from "@/lib/domain/exposure";
import { percent, percentSigned } from "@/lib/format";

/**
 * 나스닥100 실효 노출. 명목 비중만 보면 레버리지가 안 드러나서, 비중에 배수를
 * 곱해 더한 값을 같이 보여준다 — 지수가 1% 움직일 때 계좌가 몇 % 움직이는지다.
 */
export function QqqExposure({
  current,
  past,
}: {
  current: ExposureSummary;
  past: { label: string; summary: ExposureSummary }[];
}) {
  if (current.lines.length === 0 && past.length === 0) {
    return <p className="text-sm text-muted">배수가 잡힌 보유 종목이 없습니다.</p>;
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,260px)_1fr] lg:items-start">
      <div>
        <p className="text-[11px] text-muted">실효 노출</p>
        <p className="tnum mt-1 text-[34px] font-black leading-none tracking-tight">
          {percent(current.effectivePercent, 1)}
        </p>
        <p className="mt-2 text-[11px] leading-5 text-faint">
          명목 비중 {percent(current.nominalPercent, 1)} · 지수가 1% 움직이면 계좌는 약{" "}
          {(current.effectivePercent / 100).toFixed(2)}% 움직입니다
        </p>

        {past.length > 0 ? (
          <dl className="mt-4 flex flex-wrap gap-x-5 gap-y-2 border-t border-line pt-3">
            {past.map(({ label, summary }) => {
              const diff = current.effectivePercent - summary.effectivePercent;
              return (
                <div key={label}>
                  <dt className="text-[11px] text-faint">{label}</dt>
                  <dd className="tnum mt-0.5 text-[13px] font-semibold">
                    {percent(summary.effectivePercent, 1)}
                    <span className={`ml-1.5 text-[11px] ${diff >= 0 ? "text-up" : "text-down"}`}>
                      {percentSigned(diff, 1)}p
                    </span>
                  </dd>
                </div>
              );
            })}
          </dl>
        ) : null}
      </div>

      <ul className="space-y-2">
        {current.lines.map((line) => (
          <li key={line.symbolId} className="flex items-center gap-3">
            <span className="w-[58px] shrink-0 text-[12px] font-bold tracking-tight">{line.symbolId}</span>
            <span className="w-[34px] shrink-0 rounded bg-accent-soft text-center text-[10px] font-bold text-accent">
              {line.leverage}x
            </span>
            <span className="flex h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-bg-elevated">
              <span
                className="h-full rounded-full bg-accent"
                style={{ width: `${Math.min(line.exposurePercent, 100)}%` }}
              />
            </span>
            <span className="tnum w-[58px] shrink-0 text-right text-[12px] font-semibold">
              {percent(line.exposurePercent, 1)}
            </span>
            <span className="tnum hidden w-[88px] shrink-0 text-right text-[11px] text-faint sm:block">
              비중 {percent(line.weightPercent, 1)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
