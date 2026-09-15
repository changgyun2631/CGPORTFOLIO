import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // git worktree가 이 저장소 안(.claude/worktrees/)에 중첩될 수 있다. vitest 기본
    // 제외 목록은 node_modules 정도라, 워크트리 쪽 테스트 파일까지 같이 잡혀 중복
    // 실행된다.
    exclude: ["**/node_modules/**", "**/.next/**", "**/.claude/worktrees/**"],
  },
});
