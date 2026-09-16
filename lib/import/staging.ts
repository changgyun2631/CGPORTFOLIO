import "server-only";

import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

/**
 * 가져오기 화면의 "미리보기 → 확인 → 적용" 2단계를 잇는 임시 저장소.
 *
 * 미리보기 단계에서 파싱한 결과를 `data/`가 아니라 OS 임시 폴더(재부팅하면
 * 사라지고, 백업·git 어느 쪽과도 안 섞인다)에 불투명 토큰으로 저장해 뒀다가,
 * "적용" 단계에서 같은 토큰으로 다시 읽는다. 한 번 읽으면(성공이든 실패든)
 * 즉시 지워서 같은 토큰으로 두 번 적용하는 걸 막는다(재실행/중복 업로드 방지).
 * 30분이 지난 토큰은 거부한다 — 브라우저 탭을 열어 둔 채 오래 방치했다가
 * 그 사이 데이터가 바뀐 상태에 옛 미리보기를 적용하는 사고를 줄인다.
 */

const STAGING_DIR = join(tmpdir(), "cgportfolio-import-staging");
const TTL_MS = 30 * 60 * 1000;

function ensureDir() {
  mkdirSync(STAGING_DIR, { recursive: true });
}

function stagingPath(token: string): string {
  // 토큰은 우리가 randomUUID로 만든 값만 받는다 — 경로 조작 방지로 형식도 확인한다.
  if (!/^[0-9a-f-]{36}$/.test(token)) throw new Error("가져오기 토큰이 올바르지 않습니다.");
  return join(STAGING_DIR, `${token}.json`);
}

/** 미리보기 결과를 임시로 저장하고 토큰을 발급한다. */
export function stageImport<T>(kind: string, payload: T): string {
  ensureDir();
  const token = randomUUID();
  const record = { kind, createdAt: new Date().toISOString(), payload };
  writeFileSync(stagingPath(token), JSON.stringify(record), "utf8");
  return token;
}

/** 토큰으로 저장된 값을 한 번만 읽는다 — 읽고 나면(성공/실패 무관) 즉시 지운다. */
export function consumeStagedImport<T>(kind: string, token: string): T {
  const path = stagingPath(token);
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    throw new Error("가져오기 미리보기를 찾을 수 없습니다. 다시 업로드해 주세요.");
  } finally {
    try {
      rmSync(path, { force: true });
    } catch {
      // 이미 없어졌으면 무시 — 어차피 재사용을 막는 게 목적이라 지워지기만 하면 된다.
    }
  }

  const record = JSON.parse(raw) as { kind: string; createdAt: string; payload: T };
  if (record.kind !== kind) throw new Error("가져오기 종류가 일치하지 않습니다.");
  if (Date.now() - Date.parse(record.createdAt) > TTL_MS) {
    throw new Error("미리보기가 30분을 넘어 만료됐습니다. 다시 업로드해 주세요.");
  }
  return record.payload;
}

/** 오래된 임시 파일을 정리한다. 앱이 오래 떠 있으면 TTL이 지난 미적용 미리보기가 쌓일 수 있어서 가져오기 화면을 열 때마다 한 번씩 청소한다. */
export function pruneStaleStagedImports(): void {
  ensureDir();
  let entries: string[];
  try {
    entries = readdirSync(STAGING_DIR);
  } catch {
    return;
  }
  const now = Date.now();
  for (const name of entries) {
    const path = join(STAGING_DIR, name);
    try {
      if (now - statSync(path).mtimeMs > TTL_MS) rmSync(path, { force: true });
    } catch {
      // 그 사이 다른 요청이 먼저 지웠을 수 있다 — 무시.
    }
  }
}
