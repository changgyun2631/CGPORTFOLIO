import type { Metadata } from "next";
import type { ReactNode } from "react";

import { Card, PageTitle } from "@/components/ui/primitives";
import { readRefreshLogSummary, readServerLogSummary } from "@/lib/status/read-logs";
import { nextScheduledRun } from "@/lib/domain/log-status";
import { shortDateTime } from "@/lib/format";

/** WORK_ORDER 0-3절에 등록된 고정 스케줄(KST 시각). 실제 작업 스케줄러 등록을 바꾸면 여기도 같이 고칠 것. */
const REFRESH_SCHEDULE_HOURS_KST = [2, 8, 14, 20];

export const metadata: Metadata = { title: "운영 상태" };

// 매 요청 로그 파일을 다시 읽어야 하므로 정적 캐시하면 안 된다.
export const dynamic = "force-dynamic";

function Badge({ tone, children }: { tone: "ok" | "warn" | "muted"; children: ReactNode }) {
  const cls =
    tone === "ok"
      ? "border-up/40 bg-up-soft text-up"
      : tone === "warn"
        ? "border-down/40 bg-down-soft text-down"
        : "border-line text-faint";
  return <span className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[11px] font-semibold ${cls}`}>{children}</span>;
}

export default function StatusPage() {
  const now = new Date();
  const server = readServerLogSummary(now);
  const refresh = readRefreshLogSummary();
  const nextRefreshAt = nextScheduledRun(now, REFRESH_SCHEDULE_HOURS_KST);

  const serverHealthy = server.restartsLast24h <= 1 && !server.rapidRestartWarning;
  const refreshHealthy = refresh.lastFailure === null || (refresh.lastSuccess && refresh.lastSuccess.at > refresh.lastFailure.at);

  return (
    <div className="space-y-8">
      <PageTitle
        title="운영 상태"
        description="server.log·refresh.log를 읽어 만든 진단 화면입니다. 평가금액 등 개인 금융 수치는 어디에도 나오지 않습니다."
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <div className="flex items-center justify-between">
            <h3 className="text-[15px] font-semibold tracking-tight">서버 재시작</h3>
            {server.rapidRestartWarning ? (
              <Badge tone="warn">크래시 루프 의심</Badge>
            ) : serverHealthy ? (
              <Badge tone="ok">정상</Badge>
            ) : (
              <Badge tone="warn">재시작 잦음</Badge>
            )}
          </div>
          <dl className="mt-4 grid grid-cols-2 gap-3 text-xs">
            <div>
              <dt className="text-faint">최근 24시간 재시작</dt>
              <dd className="tnum mt-0.5 text-base font-bold">{server.restartsLast24h}회</dd>
            </div>
            <div>
              <dt className="text-faint">마지막 기동</dt>
              <dd className="tnum mt-0.5 text-base font-bold">
                {server.lastStartedAt ? shortDateTime(server.lastStartedAt) : "기록 없음"}
              </dd>
            </div>
          </dl>
          <p className="mt-3 text-[11px] leading-4 text-faint">
            정상 가동 중이면 하루 0~1회가 기준입니다(WORK_ORDER B-0). 재시작이 잦으면 포트 충돌이나 Windows 재부팅 여부를
            확인하세요.
          </p>
          {server.events.length > 0 ? (
            <ul className="mt-3 space-y-1 border-t border-line pt-3 text-[11px]">
              {[...server.events]
                .reverse()
                .slice(0, 8)
                .map((event, index) => (
                  <li key={index} className="flex items-center justify-between">
                    <span className={event.type === "starting" ? "text-up" : "text-down"}>
                      {event.type === "starting" ? "기동" : "종료"}
                    </span>
                    <span className="tnum text-faint">{shortDateTime(event.at)}</span>
                  </li>
                ))}
            </ul>
          ) : (
            <p className="mt-3 border-t border-line pt-3 text-[11px] text-faint">기록된 이벤트가 없습니다.</p>
          )}
        </Card>

        <Card>
          <div className="flex items-center justify-between">
            <h3 className="text-[15px] font-semibold tracking-tight">시세 갱신</h3>
            {refreshHealthy ? <Badge tone="ok">정상</Badge> : <Badge tone="warn">최근 실패 있음</Badge>}
          </div>
          <dl className="mt-4 grid grid-cols-2 gap-3 text-xs">
            <div>
              <dt className="text-faint">마지막 성공</dt>
              <dd className="tnum mt-0.5 text-base font-bold">
                {refresh.lastSuccess ? shortDateTime(refresh.lastSuccess.at) : "기록 없음"}
              </dd>
              {refresh.lastSuccess ? (
                <dd className="tnum mt-0.5 text-[11px] text-faint">
                  갱신 {refresh.lastSuccess.updated}건 · 누락 {refresh.lastSuccess.missing}건 · 오류{" "}
                  {refresh.lastSuccess.errors}건
                </dd>
              ) : null}
            </div>
            <div>
              <dt className="text-faint">마지막 실패</dt>
              <dd className="tnum mt-0.5 text-base font-bold">
                {refresh.lastFailure ? shortDateTime(refresh.lastFailure.at) : "없음"}
              </dd>
              {refresh.lastFailure ? <dd className="mt-0.5 text-[11px] text-faint">{refresh.lastFailure.reason}</dd> : null}
            </div>
          </dl>
          <p className="mt-3 text-[11px] leading-4 text-faint">
            최근 {refresh.recentTotal}회 중 {refresh.recentFailureCount}회 실패. 다음 예정{" "}
            <span className="tnum font-semibold text-muted">{shortDateTime(nextRefreshAt)}</span>
            (등록된 주기: 6시간마다, 02/08/14/20시)
          </p>
        </Card>
      </div>
    </div>
  );
}
