import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // tsconfig.json의 "paths": { "@/*": ["./*"] }와 같은 매핑이다. vitest는
    // tsconfig paths를 자동으로 읽지 않아서(플러그인 없이는), 지금까지 "@/..."로
    // 값을 import하는 파일(views.ts, app/ 라우트 등)은 아예 테스트할 수 없었다
    // (WORK_ORDER B-0A-3 회귀 테스트를 쓰다가 발견함). vite 내장 resolve.alias만
    // 쓰면 되므로 새 의존성은 필요 없다.
    alias: { "@": fileURLToPath(new URL(".", import.meta.url)) },
  },
  test: {
    // git worktree가 이 저장소 안(.claude/worktrees/)에 중첩될 수 있다. vitest 기본
    // 제외 목록은 node_modules 정도라, 워크트리 쪽 테스트 파일까지 같이 잡혀 중복
    // 실행된다.
    exclude: ["**/node_modules/**", "**/.next/**", "**/.claude/worktrees/**"],
  },
});
