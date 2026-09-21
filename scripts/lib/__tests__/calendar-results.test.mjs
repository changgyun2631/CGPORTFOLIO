import { describe, expect, it } from "vitest";
import { BLS_SERIES, failedResult, makeResult, parseBls, parseSec, shiftMonth, sourceKey, validSource } from "../calendar-results.mjs";

const source = { provider: "sec", cik: "0000000001", period: "2026-06" };
const event = { id: "test", date: "2026-07-20", resultSource: source };
const now = new Date("2026-08-01T00:00:00Z");
const fact = (start, end, val, extra = {}) => ({ start, end, val, filed: "2026-07-20", form: "10-Q", ...extra });
const sec = (revenue, eps = []) => ({ cik: 1, facts: { "us-gaap": {
  RevenueFromContractWithCustomerExcludingAssessedTax: { units: { USD: revenue } },
  EarningsPerShareDiluted: { units: { "USD/shares": eps } },
} } });
const bls = (values = [[1000, 1100, 1150], [4, 4.1, 4.2], [20, 21, 21.42]]) => ({ status: "REQUEST_SUCCEEDED", Results: { series: BLS_SERIES.map((seriesID, index) => ({ seriesID, data: values[index].map((value, m) => ({ year: "2026", period: `M0${m + 1}`, value: String(value) })) })) } });

describe("무료 캘린더 결과", () => {
  it("대상 월과 CIK를 검증하고 연도 경계를 계산한다", () => {
    expect(validSource(source)).toBe(true);
    expect(validSource({ ...source, cik: "../bad" })).toBe(false);
    expect(validSource({ ...source, period: "2026-13" })).toBe(false);
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(sourceKey(source)).toBe("sec:0000000001:2026-06");
  });
  it("고용은 총원 아닌 월간 증가, 임금은 전월비, 실업률은 수준값이다", () => {
    const rows = parseBls(bls(), "2026-03");
    expect(rows[0]).toMatchObject({ previous: 100, actual: 50, unit: "천 명" });
    expect(rows[1]).toMatchObject({ previous: 4.1, actual: 4.2 });
    expect(rows[2]).toMatchObject({ previous: 5, actual: 2 });
  });
  it("발표 전에는 전월 값만 있고 이번 결과를 0으로 만들지 않는다", () => {
    const rows = parseBls(bls(), "2026-04");
    expect(rows[0].actual).toBeNull();
    expect(rows[0].previous).toBe(50);
  });
  it("빈 값, 연평균 M13, 중간 월 누락을 유효한 결과로 쓰지 않는다", () => {
    const data = bls();
    data.Results.series[0].data[2].value = "";
    data.Results.series[1].data[2].period = "M13";
    data.Results.series[2].data.splice(1, 1);
    expect(parseBls(data, "2026-03").map((r) => r.actual)).toEqual([null, null, null]);
  });
  it("원천 오류·시계열 누락은 실패 처리한다", () => {
    expect(() => parseBls({ status: "REQUEST_NOT_PROCESSED" }, "2026-03")).toThrow();
    const data = bls(); data.Results.series.pop();
    expect(() => parseBls(data, "2026-03")).toThrow();
  });
  it("SEC 분기 매출·전분기·전년동기를 동일 기준으로 선택한다", () => {
    const rows = parseSec(sec([
      fact("2025-04-01", "2025-06-30", 80), fact("2026-01-01", "2026-03-31", 90),
      fact("2026-04-01", "2026-06-30", 100), fact("2026-01-01", "2026-06-30", 190),
    ], [fact("2026-04-01", "2026-06-30", 0)]), source, "2026-08-01");
    expect(rows[0]).toMatchObject({ actual: 100, previous: 90, yearAgo: 80, unit: "USD" });
    expect(rows[1].actual).toBe(0);
  });
  it("연간/누적 EPS에서 분기 EPS를 빼거나 추정하지 않는다", () => {
    const rows = parseSec(sec([], [fact("2026-01-01", "2026-06-30", 3)]), source, "2026-08-01");
    expect(rows[1].actual).toBeNull();
  });
  it("미래 공시는 제외하고 수정 공시의 최신 관측치를 사용한다", () => {
    const rows = parseSec(sec([
      fact("2026-04-01", "2026-06-30", 100),
      fact("2026-04-01", "2026-06-30", 101, { filed: "2026-07-25", form: "10-Q/A" }),
      fact("2026-04-01", "2026-06-30", 999, { filed: "2026-09-01" }),
    ]), source, "2026-08-01");
    expect(rows[0].actual).toBe(101);
  });
  it("통화·태그를 혼합하거나 다른 기업 데이터를 받지 않는다", () => {
    const data = sec([fact("2026-04-01", "2026-06-30", 100)]);
    data.facts["us-gaap"].RevenueFromContractWithCustomerExcludingAssessedTax.units.EUR = [fact("2026-01-01", "2026-03-31", 90)];
    expect(parseSec(data, source, "2026-08-01")[0].previous).toBeNull();
    expect(() => parseSec({ ...data, cik: 2 }, source, "2026-08-01")).toThrow();
  });
  it("최초 수집값을 보존하되 다른 대상 기간으로 넘기지 않는다", () => {
    const rows = parseSec(sec([fact("2026-04-01", "2026-06-30", 100)]), source, "2026-08-01");
    const first = makeResult(event, rows, now);
    const revised = makeResult(event, [{ ...rows[0], actual: 110 }, rows[1]], now, first);
    expect(revised.metrics[0]).toMatchObject({ actual: 110, firstObserved: 100 });
    const changed = makeResult({ ...event, resultSource: { ...source, period: "2026-09" } }, [{ ...rows[0], actual: 120 }], now, first);
    expect(changed.metrics[0].firstObserved).toBe(120);
  });
  it("실패 시 마지막 성공 데이터·시각을 보존한다", () => {
    const first = makeResult(event, parseSec(sec([fact("2026-04-01", "2026-06-30", 100)]), source, "2026-08-01"), now);
    const failure = failedResult(event, new Date("2026-08-02"), first, "HTTP 403");
    expect(failure).toMatchObject({ status: "error", lastSuccessAt: first.lastSuccessAt });
    expect(failure.metrics).toEqual(first.metrics);
    expect(failedResult({ ...event, resultSource: { ...source, period: "2026-09" } }, now, first, "오류").metrics).toEqual([]);
  });
  it("성공 응답에서 확인된 결과가 사라지면 기존 데이터를 지우지 않는다", () => {
    const rows = parseSec(sec([fact("2026-04-01", "2026-06-30", 100)]), source, "2026-08-01");
    const first = makeResult(event, rows, now);
    expect(() => makeResult(event, rows.map((r) => ({ ...r, actual: null })), now, first)).toThrow("누락");
    expect(failedResult(event, now, first, "누락").metrics[0].actual).toBe(100);
  });
  it("대기·미수집·일부·완료 상태를 구분한다", () => {
    const empty = parseBls(bls(), "2026-04");
    const e = { ...event, resultSource: { provider: "bls", period: "2026-04" } };
    expect(makeResult({ ...e, date: "2026-09-01" }, empty, now).status).toBe("pending");
    expect(makeResult(e, empty, now).status).toBe("unavailable");
    expect(makeResult(e, [{ ...empty[0], actual: 1 }, empty[1]], now).status).toBe("partial");
    expect(makeResult(e, [{ ...empty[0], actual: 1 }], now).status).toBe("available");
  });
});
