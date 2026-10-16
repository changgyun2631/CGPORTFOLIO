import type { Metadata, Viewport } from "next";
import Link from "next/link";

import { TopNav } from "@/components/shell/top-nav";
import { site } from "@/lib/config";

import "./globals.css";

export const metadata: Metadata = {
  title: { default: `대시보드 | ${site.name}`, template: `%s | ${site.name}` },
  description: site.description,
  // 아이폰 "홈 화면에 추가"를 앱 창(주소창 없음)으로 열리게 한다. 이미 켜져 있으면 새 탭을 또 열지 않고 그 앱으로 돌아간다.
  appleWebApp: { capable: true, title: site.name, statusBarStyle: "black" },
};

export const viewport: Viewport = {
  themeColor: "#07090e", // 기본 다크 테마의 배경색(globals.css --bg)
};

/**
 * 테마를 첫 페인트 전에 확정해서 화면이 번쩍이지 않게 한다.
 * 인라인 스크립트라 React 하이드레이션보다 먼저 돈다.
 */
const themeBootstrap = `
(function () {
  try {
    var saved = localStorage.getItem('theme');
    var mode = saved === 'light' || saved === 'dark' ? saved
      : (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
    document.documentElement.setAttribute('data-theme', mode);
  } catch (e) {
    document.documentElement.setAttribute('data-theme', 'dark');
  }
})();
`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ko" data-theme="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootstrap }} />
      </head>
      <body
        className="min-h-screen bg-bg text-text"
      >
        <TopNav />
        {/* 폭 상한 없이 화면을 다 쓴다. 표·차트가 많아서 넓을수록 한눈에 들어온다 —
            줄글 위주인 투자철학·리포트만 각 페이지에서 따로 좁게 잡는다. */}
        <main className="w-full px-4 pb-24 pt-6 sm:px-6 lg:px-8">{children}</main>
        <footer className="border-t border-line px-4 py-8 text-center text-xs text-faint sm:px-6">
          <p>{site.name} · 개인 자산 기록용 화면입니다. 투자 판단의 근거로 쓰기 전에 원자료를 직접 확인하세요.</p>
          <p className="mt-2">
            <Link href="/status" className="hover:text-muted hover:underline">
              운영 상태
            </Link>
          </p>
        </footer>
      </body>
    </html>
  );
}
