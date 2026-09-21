import type { FreshnessCheck } from "@/lib/domain/freshness";
import { shortDateTime } from "@/lib/format";

/**
 * 신선도 배지. **늦어진 항목만** 보여준다.
 *
 * 예전에는 최신인 항목도 "시세 기준 09/21 14:31"처럼 시각을 달고 나왔는데,
 * 바로 옆 UPDATE 줄과 제목 줄에도 비슷한 시각이 있어서 같은 이야기가 세 번
 * 나왔다(2026-09-21 사용자 지적). 최신일 때 굳이 알릴 것이 없으니 감춘다 —
 * 항목별 기준 시각은 UPDATE 줄에 마우스를 올리면 나온다.
 */

const LEVEL_STYLE: Record<FreshnessCheck["level"], string> = {
  fresh: "border-line text-faint",
  stale: "border-down/40 bg-down-soft text-down",
  missing: "border-down/40 bg-down-soft text-down",
};

export function FreshnessBadges({ checks }: { checks: FreshnessCheck[] }) {
  const needsAttention = checks.filter((check) => check.level !== "fresh");
  if (needsAttention.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1.5">
      {needsAttention.map((check) => (
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
