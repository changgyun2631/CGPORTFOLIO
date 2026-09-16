import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { NextResponse } from "next/server";

import { writeJsonAtomic, withDataLock } from "@/lib/data/atomic-write";
import { loadQqqExposure } from "@/lib/data/views";
import {
  buildWeeklyExposureReport,
  upsertWeeklyReport,
  type GeneratedReport,
} from "@/lib/domain/weekly-report";

/**
 * 그 주의 노출 리포트를 만들어 `data/weekly-reports.json`에 남긴다.
 *
 * 대시보드는 항상 "지금"만 보여주므로, 시간이 지난 뒤 그 주에 어땠는지를 되짚으려면
 * 그 시점 값을 얼려 둔 글이 따로 있어야 한다. 계산은 화면과 같은 함수를 쓴다
 * (`lib/domain/exposure.ts`) — 스크립트에서 따로 구현하지 않으려고, 시세 갱신과
 * 같은 방식으로 "예약 실행이 서버의 이 경로를 호출"하는 구조로 뒀다.
 *
 * 같은 주에 여러 번 불러도 같은 슬러그를 덮어쓸 뿐 글이 늘어나지 않는다.
 */

export const dynamic = "force-dynamic";

const dataDir = join(process.cwd(), "data");
const targetPath = join(dataDir, "weekly-reports.json");

function authorize(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true; // 비워두면 로컬 개발용으로 열어 둔다.
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

async function readExisting(): Promise<GeneratedReport[]> {
  try {
    return JSON.parse(await readFile(targetPath, "utf8")) as GeneratedReport[];
  } catch {
    return [];
  }
}

export async function GET(request: Request) {
  if (!authorize(request)) {
    return NextResponse.json({ ok: false, error: "인증 실패" }, { status: 401 });
  }

  try {
    const { current, past } = await loadQqqExposure();
    const report = buildWeeklyExposureReport({ at: new Date().toISOString(), current, past });

    const saved = await withDataLock(dataDir, async () => {
      const next = upsertWeeklyReport(await readExisting(), report);
      writeJsonAtomic(targetPath, `${JSON.stringify(next, null, 2)}\n`);
      return next.length;
    });

    return NextResponse.json({ ok: true, slug: report.slug, title: report.title, total: saved });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
