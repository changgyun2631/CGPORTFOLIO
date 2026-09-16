import type { FreshnessCheck } from "@/lib/domain/freshness";
import { shortDateTime } from "@/lib/format";

/** 신선도 배지. fresh는 눈에 안 띄게, stale/missing만 "업데이트 필요"로 강조한다. */

const LEVEL_STYLE: Record<FreshnessCheck["level"], string> = {
  fresh: "border-line text-faint",
  stale: "border-down/40 bg-down-soft text-down",
  missing: "border-down/40 bg-down-soft text-down",
};

export function FreshnessBadges({ checks }: { checks: FreshnessCheck[] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {checks.map((check) => (
        <span
          key={check.label}
          className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-medium ${LEVEL_STYLE[check.level]}`}
          title={
            check.asOf
              ? `${check.label} 기준 ${shortDateTime(check.asOf)} · 임계 ${check.thresholdHours}시간 초과 시 업데이트 필요`
              : `${check.label} 기준값이 없습니다`
          }
        >
          <span>
            {check.label} 기준 {check.asOf ? shortDateTime(check.asOf) : "없음"}
          </span>
          {check.level !== "fresh" ? <span className="font-bold">업데이트 필요</span> : null}
        </span>
      ))}
    </div>
  );
}
