import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { refreshCalendar } from "../calendar-refresh.mjs";

const directories = [];
function setup(events) {
  const dir = mkdtempSync(join(tmpdir(), "cg-calendar-test-")); directories.push(dir);
  writeFileSync(join(dir, "calendar.json"), JSON.stringify(events)); return dir;
}
afterEach(() => { for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true }); });
const event = { id: "one", date: "2026-07-20", resultSource: { provider: "sec", cik: "0000000001", period: "2026-06" } };
const payload = { cik: 1, facts: { "us-gaap": { RevenueFromContractWithCustomerExcludingAssessedTax: { units: { USD: [{ start: "2026-04-01", end: "2026-06-30", filed: "2026-07-20", form: "10-Q", val: 100 }] } } } } };

describe("캘린더 수집 저장", () => {
  it("같은 기업은 한 번만 호출하며 원래 일정·개인 메모를 바꾸지 않는다", async () => {
    const dir = setup([event, { ...event, id: "two" }, { id: "personal", note: "private" }]);
    const before = readFileSync(join(dir, "calendar.json"), "utf8");
    const fetchJson = vi.fn(async () => payload);
    expect(await refreshCalendar({ dataDir: dir, now: new Date("2026-08-01"), fetchJson, throttleMs: 0 })).toEqual({ updated: 2, errors: 0, total: 2 });
    expect(fetchJson).toHaveBeenCalledTimes(1);
    expect(readFileSync(join(dir, "calendar.json"), "utf8")).toBe(before);
    expect(existsSync(join(dir, ".calendar-refresh.lock"))).toBe(false);
  });
  it("다음 수집 실패 시 이전 값 보존·오류 기록·잠금 해제", async () => {
    const dir = setup([event]);
    await refreshCalendar({ dataDir: dir, now: new Date("2026-08-01"), fetchJson: async () => payload });
    expect((await refreshCalendar({ dataDir: dir, fetchJson: async () => { throw new Error("HTTP 403"); } })).errors).toBe(1);
    const saved = JSON.parse(readFileSync(join(dir, "calendar-results.json"), "utf8"));
    expect(saved.results.one.metrics[0].actual).toBe(100);
    expect(saved.results.one.status).toBe("error");
    expect(existsSync(join(dir, ".calendar-refresh.lock"))).toBe(false);
  });
  it("실행 중인 잠금은 빼앗지 않는다", async () => {
    const dir = setup([event]);
    writeFileSync(join(dir, ".calendar-refresh.lock"), String(process.pid));
    await expect(refreshCalendar({ dataDir: dir })).rejects.toThrow("이미 실행");
  });
  it("잘못된 CIK로 외부 요청을 만들지 않는다", async () => {
    const dir = setup([{ ...event, resultSource: { ...event.resultSource, cik: "../../foo" } }]);
    const fetchJson = vi.fn();
    expect((await refreshCalendar({ dataDir: dir, fetchJson })).total).toBe(0);
    expect(fetchJson).not.toHaveBeenCalled();
  });
});
