import { site } from "@/lib/config";

/** 작은 헤더에서도 획이 선명하도록 이미지 대신 벡터로 그린 CG 모노그램. */
export function BrandMark({ className = "h-11 w-11" }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" fill="none" className={`shrink-0 ${className}`} aria-hidden="true" focusable="false">
      <rect x="1" y="1" width="62" height="62" rx="17" fill="#102b46" stroke="#58718b" strokeWidth="1.5" />
      <path d="M45 10h9v9" stroke="#d8bc82" strokeWidth="2.5" />
      <path d="M30 23a12 12 0 1 0 0 18" stroke="#f3f6fc" strokeWidth="4.5" strokeLinecap="square" />
      <path d="M49 23a12 12 0 1 0 3 13h-9" stroke="#d8bc82" strokeWidth="4.5" strokeLinecap="square" />
    </svg>
  );
}

export function BrandLockup() {
  return (
    <span className="brand-lockup" role="img" aria-label={site.name}>
      <BrandMark className="h-10 w-10 sm:h-11 sm:w-11" />
      <span aria-hidden="true">
        <span className="brand-wordmark">
          <span className="brand-initials">CG</span>
          <span className="brand-name">PORTFOLIO</span>
        </span>
        <span className="brand-caption">PERSONAL WEALTH</span>
      </span>
    </span>
  );
}
