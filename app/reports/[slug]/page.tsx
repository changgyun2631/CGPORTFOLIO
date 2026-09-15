import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { MarkdownBody } from "@/components/reports/markdown-body";
import { Card } from "@/components/ui/primitives";
import { getReportBody, getReports } from "@/lib/data/store";

export async function generateStaticParams() {
  const reports = await getReports();
  return reports.map((report) => ({ slug: report.slug }));
}

export async function generateMetadata({ params }: PageProps<"/reports/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const report = (await getReports()).find((r) => r.slug === slug);
  return report ? { title: report.title, description: report.summary } : { title: "리포트" };
}

export default async function ReportDetailPage({ params }: PageProps<"/reports/[slug]">) {
  const { slug } = await params;
  const [reports, body] = await Promise.all([getReports(), getReportBody(slug)]);
  const report = reports.find((r) => r.slug === slug);
  if (!report || !body) notFound();

  const index = reports.findIndex((r) => r.slug === slug);
  const newer = index > 0 ? reports[index - 1] : null;
  const older = index >= 0 && index < reports.length - 1 ? reports[index + 1] : null;

  return (
    <article className="mx-auto max-w-[760px] space-y-8">
      <Link href="/reports" className="inline-block text-xs text-accent hover:underline">
        ← 리포트 목록
      </Link>

      <header className="space-y-3">
        <h1 className="text-[26px] font-bold leading-snug tracking-tight sm:text-[30px]">{report.title}</h1>
        <p className="text-[14px] leading-7 text-muted">{report.summary}</p>
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-faint">
          <span className="tnum">{report.publishedAt}</span>
          {report.tags?.map((tag) => (
            <span key={tag} className="rounded border border-line px-1.5 py-0.5">
              {tag}
            </span>
          ))}
        </div>
      </header>

      <Card className="sm:p-7">
        <MarkdownBody source={body} />
      </Card>

      <nav className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {newer ? (
          <Link
            href={`/reports/${newer.slug}`}
            className="rounded-2xl border border-line bg-surface p-4 transition-colors hover:border-line-strong hover:bg-surface-hover"
          >
            <p className="text-[11px] text-faint">다음 글</p>
            <p className="mt-1 text-[13px] font-semibold leading-6">{newer.title}</p>
          </Link>
        ) : (
          <span />
        )}
        {older ? (
          <Link
            href={`/reports/${older.slug}`}
            className="rounded-2xl border border-line bg-surface p-4 text-right transition-colors hover:border-line-strong hover:bg-surface-hover"
          >
            <p className="text-[11px] text-faint">이전 글</p>
            <p className="mt-1 text-[13px] font-semibold leading-6">{older.title}</p>
          </Link>
        ) : null}
      </nav>
    </article>
  );
}
