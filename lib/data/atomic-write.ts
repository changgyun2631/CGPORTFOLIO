import "server-only";

import {
  closeSync,
  copyFileSync,
  existsSync,
  fsyncSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";

/**
 * data/*.json에 안전하게 쓴다. 같은 디렉터리에 임시 파일을 쓰고 flush한 뒤, 기존
 * 파일을 `.bak`으로 남기고 원자적 rename으로 교체한다. 쓰는 도중 프로세스가 죽어도
 * 대상 파일은 이전 내용 그대로이거나(rename 전) 새 내용 그대로(rename 후)만
 * 있고, 일부만 쓰인 상태로 남지 않는다. Windows에서도 rename이 기존 파일을
 * 덮어쓰는 것을 확인했다(Node가 `MOVEFILE_REPLACE_EXISTING`으로 처리).
 */
export function writeJsonAtomic(filePath: string, content: string): void {
  const dir = dirname(filePath);
  const tmpPath = join(dir, `.${basename(filePath)}.tmp-${process.pid}-${Date.now()}`);
  let renamed = false;
  try {
    const fd = openSync(tmpPath, "w");
    try {
      writeSync(fd, content, null, "utf8");
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    if (existsSync(filePath)) {
      try {
        copyFileSync(filePath, `${filePath}.bak`);
      } catch {
        // 백업 실패로 교체 자체를 막지는 않는다 — 최선의 노력이다.
      }
    }
    renameSync(tmpPath, filePath);
    renamed = true;
  } finally {
    // rename이 실패하면(Windows에서 다른 프로세스가 대상 파일을 잠깐 잡으면 EPERM이
    // 난다) 임시 파일이 그대로 남는다. 그 안에는 대상과 같은 실제 계좌 데이터가
    // 들어 있으므로 반드시 지운다. 정리 실패가 원래 예외를 덮지 않게 삼킨다.
    if (!renamed) {
      try {
        unlinkSync(tmpPath);
      } catch {
        // 이미 없거나 지울 수 없으면 원래 예외를 그대로 올린다.
      }
    }
  }
}

const LOCK_STALE_MS = 5 * 60 * 1000; // 정상 작업은 이보다 훨씬 빨리 끝난다.

type LockPayload = { pid: number; startedAt: string };

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

function acquireLock(lockPath: string): void {
  const payload = JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() } satisfies LockPayload);
  try {
    writeFileSync(lockPath, payload, { flag: "wx" });
    return;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }

  let holder: LockPayload | null = null;
  try {
    holder = JSON.parse(readFileSync(lockPath, "utf8")) as LockPayload;
  } catch {
    holder = null;
  }

  const age = holder ? Date.now() - Date.parse(holder.startedAt) : Infinity;
  const stale = !holder || age > LOCK_STALE_MS || !isProcessAlive(holder.pid);
  if (!stale) {
    throw new Error(
      `data/ 쓰기 잠금이 이미 걸려 있습니다 (pid ${holder!.pid}, ${Math.round(age / 1000)}초 전 시작). ` +
        "가져오기 스크립트와 겹친 것 같습니다. 잠시 후 다시 시도하세요.",
    );
  }

  // 죽은 프로세스가 남긴 잠금 — 정리하고 내가 잡는다.
  try {
    unlinkSync(lockPath);
  } catch {
    // 그 사이 다른 프로세스가 먼저 지웠을 수 있다.
  }
  writeFileSync(lockPath, payload, { flag: "wx" });
}

function releaseLock(lockPath: string): void {
  try {
    unlinkSync(lockPath);
  } catch {
    // 이미 없어졌으면 무시.
  }
}

/**
 * data/ 쓰기 작업 전체를 잠근다. cron(서버)과 가져오기 스크립트가 동시에
 * data/*.json을 건드리면 서로의 쓰기를 덮어쓸 수 있어, 겹치면 즉시 에러로
 * 감지해 막는다 (자동 재시도·직렬화는 하지 않는다 — 호출자가 다시 시도한다).
 */
export async function withDataLock<T>(dataDir: string, fn: () => Promise<T>): Promise<T> {
  const lockPath = join(dataDir, ".write.lock");
  acquireLock(lockPath);
  try {
    return await fn();
  } finally {
    releaseLock(lockPath);
  }
}
