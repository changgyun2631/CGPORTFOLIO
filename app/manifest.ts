import type { MetadataRoute } from "next";

import { site } from "@/lib/config";

/**
 * 홈 화면에 추가했을 때 브라우저 탭이 아니라 앱 창으로 열리게 하는 앱 정보.
 * 이미 켜져 있으면 새 창을 또 열지 않고 그 앱으로 돌아간다(탭이 중복으로 쌓이지 않는다).
 * 로그인 보호(proxy.ts)가 이 파일만은 로그인 전에도 열어 준다.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: site.name,
    short_name: site.name,
    description: site.description,
    lang: "ko",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#07090e", // 기본 다크 테마(globals.css --bg)
    theme_color: "#07090e",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
