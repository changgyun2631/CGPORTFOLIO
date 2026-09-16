import { NextResponse } from "next/server";

import { readJob, runningJob } from "@/lib/data/refresh-job";

/**
 * 시세 갱신 작업의 상태. `scripts/refresh-quotes.mjs`가 짧은 간격으로 물어본다 —
 * 긴 응답 하나를 기다리지 않는 구조라(`lib/data/refresh-job.ts` 참고) 이 조회는
 * 항상 즉시 끝난다.
 */

export const dynamic = "force-dynamic";

function authorize(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(request: Request) {
  if (!authorize(request)) {
    return NextResponse.json({ ok: false, error: "인증 실패" }, { status: 401 });
  }

  const jobId = new URL(request.url).searchParams.get("jobId");
  if (!jobId) {
    const running = runningJob();
    return NextResponse.json({ ok: true, running: running ? running.jobId : null });
  }

  const job = readJob(jobId);
  if (!job) {
    return NextResponse.json({ ok: false, error: "모르는 jobId입니다.", code: "unknown-job" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, job });
}
