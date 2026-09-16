/**
 * Twelve Data `time_series` 응답을 `data/prices.json`이 쓰는 `{ d, c }[]`
 * (과거→최신 순)로 바꾸는 순수 함수. `scripts/fetch-price-history.mjs`가 쓴다.
 */

/** API가 최신순으로 주는 값을 과거→최신 순으로 뒤집고, 숫자·날짜 순서를 검증한다. */
export function parseTimeSeriesResponse(symbolId, payload) {
  if (payload?.status === "error" || payload?.code) {
    throw new Error(payload?.message ?? `${symbolId} 응답 오류`);
  }
  const values = payload?.values;
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error(`${symbolId} 응답에 values가 없습니다`);
  }

  const series = values
    .map((v) => {
      const c = Number(v.close);
      if (!Number.isFinite(c)) throw new Error(`${symbolId} close가 숫자가 아닙니다 (${v.close})`);
      if (typeof v.datetime !== "string" || !/^\d{4}-\d{2}-\d{2}/.test(v.datetime)) {
        throw new Error(`${symbolId} datetime 형식이 이상합니다 (${v.datetime})`);
      }
      return { d: v.datetime.slice(0, 10), c };
    })
    .reverse(); // Twelve Data는 최신순으로 준다 — 저장 형식(과거→최신)에 맞춘다.

  for (let i = 1; i < series.length; i += 1) {
    if (series[i].d <= series[i - 1].d) {
      throw new Error(`${symbolId} 날짜 순서가 이상합니다 (${series[i - 1].d} -> ${series[i].d})`);
    }
  }

  return series;
}

/**
 * 새로 받은 종목별 시계열을 기존 `prices.json` 위에 덮어쓴다. 실패한 종목은
 * `fetched`에 아예 안 들어오므로 기존 값이 자동으로 보존된다 — 부분 실패로
 * 이미 있던 데이터를 잃지 않는다.
 */
export function mergePriceHistory(existing, fetched) {
  return { ...existing, ...fetched };
}
