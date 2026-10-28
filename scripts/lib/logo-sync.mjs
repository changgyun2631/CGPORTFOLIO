import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

/**
 * 캘린더에 쓰는 회사 로고를 Twelve Data `logo`에서 받아 `data/logos/{티커}.jpg`로 저장한다.
 * 한 번 받으면 다시 받지 않고, 로고가 없는 티커는 `{티커}.none`으로 표시해 다시 묻지 않는다.
 * 조회 1건이 크레딧 1개라(무료 분당 8) 호출 사이를 띄우고 한 번에 `limit`개까지만 받는다.
 * 한도(429)에 걸리면 표시 없이 멈춰서 다음 실행에 이어 받는다. 로고 파일은 저장소에 올리지 않는다.
 */

const API = "https://api.twelvedata.com";
const SYMBOL = /^[A-Z0-9.-]{1,10}$/;

async function lookup(symbol, apiKey) {
  const res = await fetch(`${API}/logo?symbol=${encodeURIComponent(symbol)}&apikey=${apiKey}`, { signal: AbortSignal.timeout(15000) });
  return res.json();
}

async function image(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok || !res.headers.get("content-type")?.startsWith("image/")) throw new Error(`로고 이미지 HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

export async function syncLogos(symbols, { dataDir = join(process.cwd(), "data"), apiKey = process.env.TWELVE_DATA_API_KEY, limit = 25, throttleMs = 8000, lookupLogo = lookup, fetchImage = image } = {}) {
  if (!apiKey) return { saved: 0, none: 0 };
  const dir = join(dataDir, "logos");
  mkdirSync(dir, { recursive: true });
  let saved = 0;
  let none = 0;
  let tried = 0;
  for (const symbol of symbols) {
    if (tried >= limit) break;
    if (!SYMBOL.test(symbol) || existsSync(join(dir, `${symbol}.jpg`)) || existsSync(join(dir, `${symbol}.none`))) continue;
    tried++;
    try {
      const meta = await lookupLogo(symbol, apiKey);
      if (meta?.code === 429) break; // 분당 한도 — 표시하지 않고 다음 실행에 이어서
      if (meta?.url) {
        writeFileSync(join(dir, `${symbol}.jpg`), await fetchImage(meta.url));
        saved++;
      } else if (meta?.code === 404 || meta?.status === "error") {
        writeFileSync(join(dir, `${symbol}.none`), "");
        none++;
      }
    } catch (error) {
      console.error(`로고 ${symbol}: ${error.message}`); // 네트워크 오류는 다음 실행에 다시 시도
    }
    await sleep(throttleMs);
  }
  return { saved, none };
}
