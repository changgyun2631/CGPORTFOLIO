import type { Metadata } from "next";

import { Card } from "@/components/ui/primitives";
import { safeReturnPath } from "@/lib/auth/redirect";
import { site } from "@/lib/config";

export const metadata: Metadata = { title: "로그인", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

type LoginPageProps = {
  searchParams: Promise<{ error?: string; next?: string; setup?: string }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const query = await searchParams;
  const next = safeReturnPath(query.next);
  const message = query.setup
    ? "서버의 로그인 설정이 아직 완료되지 않았습니다. 관리자에게 설정을 요청하세요."
    : query.error === "rate"
      ? "로그인 시도가 너무 많습니다. 15분 뒤 다시 시도하세요."
      : query.error
        ? "아이디 또는 비밀번호가 올바르지 않습니다."
        : null;

  return (
    <div className="mx-auto flex min-h-[65vh] max-w-md items-center">
      <Card className="w-full p-6 sm:p-8">
        <div className="mb-6">
          <div className="mb-4 grid h-11 w-11 place-items-center rounded-xl bg-accent text-sm font-black text-white">
            {site.shortName.slice(0, 2)}
          </div>
          <h1 className="text-2xl font-bold tracking-tight">{site.name} 로그인</h1>
          <p className="mt-2 text-sm leading-6 text-muted">개인 포트폴리오 화면입니다. 로그인 상태는 이 브라우저에서 7일간 유지됩니다.</p>
        </div>

        {message ? (
          <p role="alert" className="mb-4 rounded-xl border border-down/40 bg-down-soft px-3 py-2.5 text-sm text-down">
            {message}
          </p>
        ) : null}

        <form action="/api/auth/login" method="post" className="space-y-4">
          <input type="hidden" name="next" value={next} />
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-muted">아이디</span>
            <input
              name="username"
              autoComplete="username"
              required
              maxLength={128}
              className="w-full rounded-xl border border-line bg-bg-elevated px-3.5 py-3 text-sm outline-none transition focus:border-accent"
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-muted">비밀번호</span>
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              required
              minLength={8}
              maxLength={512}
              className="w-full rounded-xl border border-line bg-bg-elevated px-3.5 py-3 text-sm outline-none transition focus:border-accent"
            />
          </label>
          <button type="submit" className="w-full rounded-xl bg-accent px-4 py-3 text-sm font-semibold text-white transition hover:opacity-90">
            로그인
          </button>
        </form>
      </Card>
    </div>
  );
}
