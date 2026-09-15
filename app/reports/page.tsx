import type { Metadata } from "next";
import Link from "next/link";

import { Card, Empty, PageTitle } from "@/components/ui/primitives";
import { getReports } from "@/lib/data/store";

export const metadata: Metadata = { title: "리포트" };

export default async function ReportsPage() {
  const reports = await getReports();

  return (
    <div className="space-y-8">
      <PageTitle title="리포트" description="점검하며 남긴 기록입니다. 판단의 근거와 그때의 결론을 함께 적어 둡니다." />

      {reports.length === 0 ? (
        <Empty title="작성한 리포트가 없습니다" description="data/reports.json 과 data/reports/*.md 에 추가하세요." />
      ) : (
        <ul className="space-y-3">
          {reports.map((report) => (
            <li key={report.slug}>
              <Link href={`/reports/${report.slug}`} className="block">
                <Card className="transition-colors hover:border-line-strong hover:bg-surface-hover">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <h2 className="text-[15px] font-semibold tracking-tight">{report.title}</h2>
                    <span className="tnum text-[11px] text-faint">{report.publishedAt}</span>
                  </div>
                  <p className="mt-1.5 text-[13px] leading-6 text-muted">{report.summary}</p>
                  {report.tags && report.tags.length > 0 ? (
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {report.tags.map((tag) => (
                        <span key={tag} className="rounded border border-line px-1.5 py-0.5 text-[10px] text-faint">
                          {tag}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
