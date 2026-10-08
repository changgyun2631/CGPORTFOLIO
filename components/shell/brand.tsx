import { site } from "@/lib/config";

import { BRAND_EMBLEM, BRAND_VIEWBOX, BRAND_WORDMARK } from "./brand-paths";

/** 이미지 대신 벡터로 그려 어떤 크기에서도 선명하고, 색은 테마 변수(--brand-logo)를 따른다. */
export function BrandLockup() {
  return (
    <span className="brand-lockup">
      <svg viewBox={BRAND_VIEWBOX} role="img" aria-label={site.name} focusable="false">
        <path fill="var(--brand-logo)" fillRule="evenodd" d={BRAND_EMBLEM + BRAND_WORDMARK} />
      </svg>
    </span>
  );
}
