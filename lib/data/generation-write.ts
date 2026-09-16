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
 *
 * **이게 보장하지 않는 것(WORK_ORDER B-0A-4)**: 이건 JS `catch` 블록으로 하는
 * 되돌리기다. Node 프로세스가 쓰기 도중 강제 종료되거나(`kill -9`, OOM) 전원이
 * 나가면 `catch`가 아예 실행되지 않으므로 롤백도 일어나지 않는다 — 그런
 * 상황까지 견디는 진짜 "트랜잭션"은 아니다. 그 정도 보장이 필요해지면
 * write-ahead journal이나 세대+manifest 포인터 같은 별도 설계가 필요하고,
 * 여기서 그렇다고 주장하지 않는다.
 */

/**
 * 롤백에 쓸 원본 내용을 미리 읽어 둔다. 파일이 아직 없으면(`ENOENT`) `null`.
 * 권한 오류·I/O 오류처럼 "없어서가 아니라 못 읽은" 경우는 그대로 던진다 —
 * 삼켜서 `null`(=파일이 없었다)로 취급하면, 실제로는 존재하는 파일인데 롤백
 * 시점에 "원래 없었으니 지운다"로 잘못 판단해 데이터를 지울 수 있다.
 */
export function readOriginals(paths: readonly string[]): Map<string, string | null> {
  const originals = new Map<string, string | null>();
  for (const path of paths) {
    try {
      originals.set(path, readFileSync(path, "utf8"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      originals.set(path, null);
    }
  }
  return originals;
}

/**
 * 쓰기 실패 뒤 롤백까지 시도했지만 실패한 경우를 구분해서 담는 에러. 호출자가
 * `rollbackOk`를 보고 "정말 원상복구됐다"는 확신이 있을 때만 사용자에게
 * "데이터는 바뀌지 않았습니다"라고 말하고 재시도(retryToken)를 제안해야 한다 —
 * 롤백 자체가 실패했는데도 그렇게 말하면 거짓 안내가 된다(WORK_ORDER B-0A-4).
 */
export class GenerationWriteError extends Error {
  readonly writeError: Error;
  readonly rollbackOk: boolean;
  readonly rollbackErrors: readonly { path: string; error: Error }[];

  constructor(writeError: Error, rollbackErrors: readonly { path: string; error: Error }[]) {
    const rollbackOk = rollbackErrors.length === 0;
    const suffix = rollbackOk
      ? "이미 쓴 파일은 전부 원래대로 되돌렸습니다."
      : `롤백 중 ${rollbackErrors.length}개 파일 복구에도 실패했습니다 — data/ 상태가 불확실하니 직접 확인하세요.`;
    super(`${writeError.message} (${suffix})`);
    this.name = "GenerationWriteError";
    this.writeError = writeError;
    this.rollbackOk = rollbackOk;
    this.rollbackErrors = rollbackErrors;
  }
}

/**
 * 준비된 새 내용을 순서대로 원자적 교체한다. 중간에 하나라도 실패하면 그 전까지
 * 이미 쓴 파일들을 원본 상태로 되돌리려 시도하고, 원래 쓰기 오류와 롤백 오류를
 * 모두 담은 {@link GenerationWriteError}를 던진다 — 롤백 오류를 조용히 삼키지
 * 않는다(예전에는 그랬다 — 호출자가 "데이터는 안 바뀜"이라고 사용자에게
 * 잘못 말할 수 있었다).
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
    const rollbackErrors: { path: string; error: Error }[] = [];
    for (const path of written) {
      try {
        const original = originals.get(path);
        if (original === null || original === undefined) {
          if (existsSync(path)) unlinkSync(path);
        } else {
          writeJsonAtomic(path, original);
        }
      } catch (rollbackError) {
        rollbackErrors.push({ path, error: rollbackError as Error });
      }
    }
    throw new GenerationWriteError(error as Error, rollbackErrors);
  }
}
