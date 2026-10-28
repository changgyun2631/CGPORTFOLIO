import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const dynamic = "force-dynamic";

const logosDir = join(process.cwd(), "data", "logos");

/** 캘린더 로고. `scripts/lib/logo-sync.mjs`가 받아 둔 파일만 내보낸다(로그인한 사용자만 — proxy.ts가 막는다). */
export async function GET(_request: Request, { params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await params;
  if (!/^[A-Z0-9.-]{1,10}$/.test(symbol)) return new Response(null, { status: 404 });
  try {
    const file = await readFile(join(logosDir, `${symbol}.jpg`));
    return new Response(new Uint8Array(file), { headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=86400" } });
  } catch {
    return new Response(null, { status: 404 });
  }
}
