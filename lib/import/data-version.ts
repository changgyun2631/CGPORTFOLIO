import "server-only";

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * staged import(미리보기 → 적용)가 그 사이 다른 쓰기(cron, 다른 가져오기)에
 * 덮어써지지 않았는지 확인하는 용도. 미리보기 때 입력/대상 파일들의 내용 해시를
 * 찍어 토큰에 같이 저장해 두고, 적용 직전 잠금 안에서 다시 찍어 비교한다.
 * mtime이 아니라 내용 해시를 쓰는 이유는, 같은 내용을 다시 써도(예: 원자적 쓰기의
 * 백업 스텝) 오탐하지 않게 하려는 것과, 파일시스템 시각 해상도에 기대지 않으려는
 * 것이다.
 */
export function hashDataFiles(dataDir: string, names: readonly string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const name of names) {
    try {
      const content = readFileSync(join(dataDir, name), "utf8");
      result[name] = createHash("sha256").update(content).digest("hex");
    } catch {
      result[name] = "__missing__";
    }
  }
  return result;
}

/** baseline과 다른 값을 가진 파일 이름만 돌려준다. */
export function diffDataFiles(baseline: Record<string, string>, current: Record<string, string>): string[] {
  return Object.keys(baseline).filter((name) => baseline[name] !== current[name]);
}
