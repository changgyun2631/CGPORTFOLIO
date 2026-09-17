import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // 계좌수익률 CSV는 여러 파일을 한 번에 올릴 수 있어(lib/import/account-history-actions.ts),
    // 기본 1MB 한도에 여러 파일의 multipart 오버헤드까지 더하면 정상적인 업로드도
    // 걸릴 수 있다. 우리 쪽 lib/import/limits.ts가 파일당 2MB로 먼저 친절하게
    // 막으므로, 여기는 그 파일들이 합쳐졌을 때를 위한 여유(2MB짜리 몇 개 + 여백)다.
    serverActions: {
      bodySizeLimit: "8mb",
      // Server Action은 Origin과 Host(X-Forwarded-Host)를 대조하는 CSRF 검사를 한다.
      // Tailscale Funnel을 통해 들어오면 Origin이 이 공개 도메인이라, 여기 적어두지
      // 않으면 가져오기 Server Action이 전부 거부된다.
      allowedOrigins: ["cgportfolio.tailab9ee1.ts.net"],
    },
  },
};

export default nextConfig;
