import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { request } from "node:https";
import { getCACertificates } from "node:tls";
import { setTimeout as sleep } from "node:timers/promises";
import { writeJsonAtomic, withDataLock } from "./atomic-write.mjs";
import { BLS_SERIES, validSource, parseBls, parseSec, makeResult, failedResult } from "./calendar-results.mjs";

// Windows 보안 제품의 신뢰 루트도 이용하되 TLS 인증서 검증은 절대 끄지 않는다.
export function publicJson(url, { body, userAgent } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const ca = process.platform === "win32" ? [...getCACertificates("default"), ...getCACertificates("system")] : undefined;
    const req = request(url, { method: payload ? "POST" : "GET", ca,
      headers: { "User-Agent": userAgent?.trim() || "CGPortfolio/1.0 (personal calendar; github.com/changgyun2631/CGPORTFOLIO)",
        Accept: "application/json", ...(payload ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) } : {}) } }, (res) => {
      if (res.statusCode !== 200) { res.resume(); reject(new Error(`공식 원천 HTTP ${res.statusCode}`)); return; }
      const chunks = [];
      let size = 0;
      res.on("data", (chunk) => { size += chunk.length; if (size > 30 * 1024 * 1024) req.destroy(new Error("응답 크기 제한 초과")); else chunks.push(chunk); });
      res.on("error", reject);
      res.on("end", () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); } catch { reject(new Error("공식 원천 JSON 형식 오류")); } });
    });
    const timer = setTimeout(() => req.destroy(new Error("공식 원천 응답 시간 초과")), 15000);
    req.on("close", () => clearTimeout(timer));
    req.on("error", (error) => reject(new Error(error.code ? `공식 원천 연결 실패 (${error.code})` : error.message)));
    if (payload) req.write(payload);
    req.end();
  });
}

function readJson(path, fallback) {
  try { return JSON.parse(readFileSync(path, "utf8")); }
  catch (error) { if (error.code === "ENOENT") return fallback; throw error; }
}

// 수집 중 중복 실행 방지. 살아 있는 프로세스의 잠금은 시간만 보고 빼앗지 않는다.
function lock(path) {
  try { writeFileSync(path, String(process.pid), { flag: "wx" }); }
  catch (error) {
    if (error.code !== "EEXIST") throw error;
    const pid = Number(readFileSync(path, "utf8"));
    if (!Number.isInteger(pid) || pid <= 0) throw new Error("캘린더 잠금 확인 필요");
    try { process.kill(pid, 0); throw new Error("캘린더 수집이 이미 실행 중입니다"); }
    catch (check) { if (check.code !== "ESRCH") throw check; }
    unlinkSync(path);
    writeFileSync(path, String(process.pid), { flag: "wx" });
  }
}

export async function refreshCalendar({ dataDir = join(process.cwd(), "data"), now = new Date(), fetchJson = publicJson, throttleMs = 250 } = {}) {
  const lockPath = join(dataDir, ".calendar-refresh.lock");
  lock(lockPath);
  try {
    const events = readJson(join(dataDir, "calendar.json"), []);
    if (!Array.isArray(events)) throw new Error("캘린더 일정 형식 오류");
    const old = readJson(join(dataDir, "calendar-results.json"), { version: 1, results: {} });
    if (old.version !== 1 || !old.results || typeof old.results !== "object") throw new Error("기존 캘린더 결과 형식 오류");
    const targets = events.filter((e) => validSource(e.resultSource));
    const results = {};
    const requests = new Map();
    let errors = 0;
    const today = now.toISOString().slice(0, 10);
    const blsYears = targets.filter((e) => e.resultSource.provider === "bls").map((e) => Number(e.resultSource.period.slice(0, 4)));
    const startYear = Math.min(...blsYears) - 1;
    const endYear = Math.max(...blsYears);
    async function get(key, url, options) {
      if (!requests.has(key)) {
        if (requests.size) await sleep(throttleMs);
        requests.set(key, fetchJson(url, options));
      }
      return requests.get(key);
    }
    for (const event of targets) {
      const source = event.resultSource;
      try {
        let metrics;
        if (source.provider === "bls") {
          if (endYear - startYear >= 10) throw new Error("BLS 무료 조회 기간(10년) 초과");
          const payload = await get("bls", "https://api.bls.gov/publicAPI/v2/timeseries/data/", {
            body: { seriesid: BLS_SERIES, startyear: String(startYear), endyear: String(endYear) },
          });
          metrics = parseBls(payload, source.period);
        } else {
          const payload = await get(`sec:${source.cik}`, `https://data.sec.gov/api/xbrl/companyfacts/CIK${source.cik}.json`, { userAgent: process.env.SEC_USER_AGENT });
          metrics = parseSec(payload, source, today);
        }
        results[event.id] = makeResult(event, metrics, now, old.results[event.id]);
      } catch (error) {
        errors += 1;
        results[event.id] = failedResult(event, now, old.results[event.id], error.message);
      }
    }
    const output = { version: 1, checkedAt: now.toISOString(), results };
    withDataLock(dataDir, () => writeJsonAtomic(join(dataDir, "calendar-results.json"), `${JSON.stringify(output, null, 2)}\n`));
    return { updated: targets.length - errors, errors, total: targets.length };
  } finally { unlinkSync(lockPath); }
}
