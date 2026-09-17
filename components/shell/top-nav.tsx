"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

import { nav, site } from "@/lib/config";

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function TopNav() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-bg-elevated/85 backdrop-blur">
      {/*
        key에 경로를 물려두면 이동할 때 MobileMenu가 새로 마운트되면서 열림 상태가
        초기화된다. effect 안에서 setState를 부르지 않고 같은 결과를 얻는다.
      */}
      <MobileMenu key={pathname} pathname={pathname} />
    </header>
  );
}

function MobileMenu({ pathname }: { pathname: string }) {
  const [open, setOpen] = useState(false);
  const loginPage = pathname === "/login";

  return (
    <>
      <div className="flex h-14 w-full items-center gap-2 px-4 sm:px-6 lg:px-8">
        <Link href="/" className="mr-2 flex shrink-0 items-center gap-2 text-[15px] font-bold tracking-tight">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-accent text-[11px] font-black text-white">
            {site.shortName.slice(0, 2)}
          </span>
          <span className="hidden sm:inline">{site.name}</span>
        </Link>

        {!loginPage ? (
          <nav aria-label="주요 메뉴" className="hidden flex-1 items-center gap-1 md:flex">
            {nav.map((item) => {
              const active = isActive(pathname, item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={`rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors ${
                    active ? "bg-accent-soft text-accent" : "text-muted hover:bg-surface-hover hover:text-text"
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
        ) : null}

        <div className="ml-auto flex items-center gap-1">
          <ThemeToggle />
          {!loginPage ? (
            <>
              <form action="/api/auth/logout" method="post" className="hidden md:block">
                <button
                  type="submit"
                  className="rounded-lg border border-line px-2.5 py-1.5 text-xs text-muted transition-colors hover:border-line-strong hover:text-text"
                >
                  로그아웃
                </button>
              </form>
              <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                aria-expanded={open}
                aria-label="메뉴 열기"
                className="rounded-lg border border-line px-2.5 py-1.5 text-xs text-muted md:hidden"
              >
                메뉴
              </button>
            </>
          ) : null}
        </div>
      </div>

      {open && !loginPage ? (
        <nav aria-label="모바일 메뉴" className="grid grid-cols-2 gap-1 border-t border-line px-4 py-3 md:hidden">
          {nav.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`rounded-lg px-3 py-2 text-sm font-medium ${
                  active ? "bg-accent-soft text-accent" : "text-muted hover:bg-surface-hover"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
          <form action="/api/auth/logout" method="post">
            <button
              type="submit"
              className="w-full rounded-lg px-3 py-2 text-left text-sm font-medium text-muted hover:bg-surface-hover"
            >
              로그아웃
            </button>
          </form>
        </nav>
      ) : null}
    </>
  );
}

/**
 * 테마 전환.
 *
 * 현재 테마를 React 상태로 들고 있으면 서버 렌더 결과와 어긋나서 effect로
 * 맞춰줘야 한다. 대신 실제 테마는 html[data-theme]에만 두고 버튼 글자는 CSS로
 * 골라 보여준다. 상태도 effect도 필요 없어진다.
 */
function ThemeToggle() {
  const toggle = () => {
    const root = document.documentElement;
    const next = root.getAttribute("data-theme") === "light" ? "dark" : "light";
    root.setAttribute("data-theme", next);
    try {
      localStorage.setItem("theme", next);
    } catch {
      // 저장이 막혀 있어도 이번 세션 동안은 바뀐 테마로 계속 쓸 수 있다.
    }
  };

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label="테마 전환"
      className="rounded-lg border border-line px-2.5 py-1.5 text-xs text-muted transition-colors hover:border-line-strong hover:text-text"
    >
      <span className="only-dark">라이트</span>
      <span className="only-light">다크</span>
    </button>
  );
}
