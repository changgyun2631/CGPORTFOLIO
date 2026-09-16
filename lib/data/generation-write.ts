import "server-only";

import { existsSync, readFileSync, unlinkSync } from "node:fs";

import { writeJsonAtomic } from "./atomic-write";

/**
 * 여러 파일을 "한 세대"로 묶어 쓸 때 쓰는 유틸리티. cron이 quotes/fx-quote/
 * snapshots 세 파일을 매번 같이 갱신하는데, `writeJsonAtomic`은 파일 하나
 * 자체가 일부만 쓰이는 걸 막아주지만, 세 파일 "사이"의 일관성은 보장하지
 * 않는다 — 첫 번째 파일을 쓴 뒤 두 번째에서 실패하면 quotes.json은 새 세대,
 * fx-quote.json/snapshots.json은 이전 세대로 섞인 채 남을 수 있다.
 *
 * 그래서 쓰기 전에 각 파일의 원본 내용을 먼저 읽어 두고(`readOriginals`),
 * 순서대로 쓰다가 하나라도 실패하면 이미 쓴 파일들을 원본으로 되돌린다
 * (`writeGenerationOrRollback`). 원본이 없던 파일(이번에 처음 생기는 파일)은
 * 되돌릴 때 지운다 — "쓰기 전 상태"가 파일이 아예 없는 것이었기 때문이다.
 */

/** 롤백에 쓸 원본 내용을 미리 읽어 둔다. 파일이 아직 없으면 `null`. */
export function readOriginals(paths: readonly string[]): Map<string, string | null> {
  const originals = new Map<string, string | null>();
  for (const path of paths) {
    try {
      originals.set(path, readFileSync(path, "utf8"));
    } catch {
      originals.set(path, null);
    }
  }
  return originals;
}

/**
 * 준비된 새 내용을 순서대로 원자적 교체한다. 중간에 하나라도 실패하면 그 전까지
 * 이미 쓴 파일들을 원본 상태로 되돌리고(최선의 노력 — 되돌리기 자체가 실패해도
 * 원래 에러를 우선한다), 실패 원인을 다시 던진다.
 */
export function writeGenerationOrRollback(
  writes: readonly { path: string; content: string }[],
  originals: Map<string, string | null>,
): void {
  const written: string[] = [];
  try {
    for (const { path, content } of writes) {
      writeJsonAtomic(path, content);
      written.push(path);
    }
  } catch (error) {
    for (const path of written) {
      try {
        const original = originals.get(path);
        if (original === null || original === undefined) {
          if (existsSync(path)) unlinkSync(path);
        } else {
          writeJsonAtomic(path, original);
        }
      } catch {
        // 롤백 실패도 무시하고 원래 에러를 우선한다 — 최선의 노력이다.
      }
    }
    throw error;
  }
}
