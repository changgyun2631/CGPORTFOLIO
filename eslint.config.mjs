import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // git worktree가 이 저장소 안(.claude/worktrees/)에 중첩될 수 있다. 위 패턴은
    // 최상위 .next/**만 잡아서, 중첩된 워크트리의 .next 빌드 산출물까지는 못 거른다.
    "**/.claude/worktrees/**",
  ]),
]);

export default eslintConfig;
