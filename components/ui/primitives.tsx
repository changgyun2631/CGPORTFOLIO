import type { ReactNode } from "react";

import { moneySigned, percentSigned, trendOf } from "@/lib/format";

/** 화면 전체에서 반복되는 껍데기들. 여기서만 모양을 정한다. */

export function Card({
  children,
  className = "",
  padded = true,
}: {
  children: ReactNode;
  className?: string;
  padded?: boolean;
}) {
  return (
    <section className={`rounded-2xl border border-line bg-surface ${padded ? "p-4 sm:p-5" : ""} ${className}`}>{children}</section>
  );
}

export function Section({
  title,
  description,
  action,
  children,
  className = "",
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`space-y-3 ${className}`}>
      <header className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-[15px] font-semibold tracking-tight">{title}</h2>
          {description ? <p className="mt-0.5 text-xs leading-5 text-muted">{description}</p> : null}
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}

export function PageTitle({ title, description }: { title: string; description?: string }) {
  return (
    <div className="mb-6">
      <h1 className="text-2xl font-bold tracking-tight sm:text-[28px]">{title}</h1>
      {description ? <p className="mt-1.5 text-sm text-muted">{description}</p> : null}
    </div>
  );
}

/** 상승/하락에 따라 색이 바뀌는 숫자. 한국 관행대로 상승이 빨강이다. */
export function Delta({
  amount,
  percent,
  currency = "KRW",
  className = "",
  showAmount = true,
}: {
  amount?: number | null;
  percent?: number | null;
  currency?: "KRW" | "USD";
  className?: string;
  showAmount?: boolean;
}) {
  const basis = percent ?? amount ?? 0;
  const trend = trendOf(basis);
  const tone = trend === "up" ? "text-up" : trend === "down" ? "text-down" : "text-flat";

  return (
    <span className={`tnum inline-flex items-center gap-1.5 ${tone} ${className}`}>
      {showAmount && amount !== undefined && amount !== null ? <span>{moneySigned(amount, currency)}</span> : null}
      {percent !== undefined && percent !== null ? (
        <span className={showAmount && amount !== undefined && amount !== null ? "opacity-90" : ""}>{percentSigned(percent)}</span>
      ) : null}
    </span>
  );
}

/** 지표 카드. 값 하나와 부연 한 줄. */
export function Stat({
  label,
  value,
  sub,
  delta,
  tone = "default",
  href,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  delta?: ReactNode;
  tone?: "default" | "up" | "down";
  href?: string;
}) {
  const valueTone = tone === "up" ? "text-up" : tone === "down" ? "text-down" : "text-text";
  const body = (
    <>
      <p className="text-[11px] font-medium tracking-wide text-muted">{label}</p>
      <p className={`tnum mt-1.5 text-[19px] font-bold leading-tight tracking-tight sm:text-[21px] ${valueTone}`}>{value}</p>
      {delta ? <p className="mt-1 text-xs font-medium">{delta}</p> : null}
      {sub ? <p className="mt-1 text-[11px] leading-4 text-faint">{sub}</p> : null}
    </>
  );

  if (href) {
    return (
      <a href={href} className="block rounded-2xl border border-line bg-surface p-4 transition-colors hover:border-line-strong hover:bg-surface-hover">
        {body}
      </a>
    );
  }
  return <div className="rounded-2xl border border-line bg-surface p-4">{body}</div>;
}

/** 종목 코드 배지. */
export function Ticker({ id, size = "sm" }: { id: string; size?: "sm" | "md" }) {
  return (
    <span
      className={`inline-flex items-center rounded-md border border-line-strong bg-bg-elevated font-semibold tracking-tight text-text ${
        size === "md" ? "px-2 py-1 text-[13px]" : "px-1.5 py-0.5 text-[11px]"
      }`}
    >
      {id}
    </span>
  );
}

export function Empty({ title, description }: { title: string; description?: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-line px-5 py-10 text-center">
      <p className="text-sm font-medium text-muted">{title}</p>
      {description ? <p className="mt-1 text-xs text-faint">{description}</p> : null}
    </div>
  );
}

/** 비중을 보여주는 가느다란 막대. */
export function WeightBar({ weight, tone = "accent" }: { weight: number; tone?: "accent" | "up" | "down" }) {
  const color = tone === "up" ? "bg-up" : tone === "down" ? "bg-down" : "bg-accent";
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-bg-elevated">
      <div className={`h-full rounded-full ${color}`} style={{ width: `${Math.max(Math.min(weight, 100), 0)}%` }} />
    </div>
  );
}
