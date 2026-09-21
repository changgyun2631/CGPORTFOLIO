// 무료 공식 원천만 사용한다. 추정치·조정 EPS·발표일 추정은 만들지 않는다.
export const BLS_SERIES = ["CES0000000001", "LNS14000000", "CES0500000003"];
const validMonth = (value) => /^\d{4}-(0[1-9]|1[0-2])$/.test(value ?? "");
const finite = (value) => typeof value === "number" && Number.isFinite(value);
const days = (from, to) => (Date.parse(to) - Date.parse(from)) / 86400000;

export function sourceKey(source) {
  return `${source.provider}:${source.provider === "sec" ? source.cik : "employment"}:${source.period}`;
}

export function validSource(source) {
  return source && validMonth(source.period) && (source.provider === "bls" ||
    (source.provider === "sec" && /^\d{10}$/.test(source.cik ?? "")));
}

export function shiftMonth(period, amount) {
  const [year, month] = period.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1 + amount, 1)).toISOString().slice(0, 7);
}

function metric(id, label, unit, basis, actual, previous, yearAgo = null) {
  return { id, label, unit, basis, actual: actual?.value ?? null, actualPeriod: actual?.period ?? null,
    previous: previous?.value ?? null, previousPeriod: previous?.period ?? null,
    yearAgo: yearAgo?.value ?? null, yearAgoPeriod: yearAgo?.period ?? null,
    firstObserved: null, firstObservedAt: null };
}

export function parseBls(payload, period) {
  if (payload?.status !== "REQUEST_SUCCEEDED" || !Array.isArray(payload.Results?.series)) {
    throw new Error("BLS 응답 오류 또는 무료 호출 한도 초과");
  }
  const series = new Map(payload.Results.series.map((entry) => [entry.seriesID, entry.data]));
  if (BLS_SERIES.some((id) => !Array.isArray(series.get(id)) || !series.get(id).length)) {
    throw new Error("BLS 필수 시계열 누락");
  }
  function value(id, month) {
    const row = series.get(id).find((item) => `${item.year}-${item.period?.slice(1)}` === month && /^M(0[1-9]|1[0-2])$/.test(item.period));
    if (!row || typeof row.value !== "string" || !/^-?\d+(\.\d+)?$/.test(row.value)) return null;
    const n = Number(row.value);
    return Number.isFinite(n) ? n : null;
  }
  function observation(id, month, mode) {
    const n = value(id, month);
    const prev = mode === "level" ? null : value(id, shiftMonth(month, -1));
    if (n === null || (mode !== "level" && prev === null) || (mode === "growth" && prev === 0)) return null;
    const result = mode === "level" ? n : mode === "change" ? n - prev : (n / prev - 1) * 100;
    return { value: Math.round(result * 10000) / 10000, period: month };
  }
  return [
    [BLS_SERIES[0], "payroll", "비농업 고용 증가", "천 명", "change"],
    [BLS_SERIES[1], "unemployment", "실업률", "%", "level"],
    [BLS_SERIES[2], "wages", "시간당 임금 상승률(전월 대비)", "%", "growth"],
  ].map(([id, name, label, unit, mode]) => metric(name, label, unit, "BLS · 계절조정 · 최신 수정치",
    observation(id, period, mode), observation(id, shiftMonth(period, -1), mode)));
}

const SEC_TAGS = {
  revenue: [
    ["us-gaap", "RevenueFromContractWithCustomerExcludingAssessedTax"],
    ["us-gaap", "RevenueFromContractWithCustomerIncludingAssessedTax"],
    ["us-gaap", "Revenues"], ["us-gaap", "SalesRevenueNet"], ["ifrs-full", "Revenue"],
  ],
  eps: [["us-gaap", "EarningsPerShareDiluted"], ["ifrs-full", "DilutedEarningsLossPerShare"]],
};

// 6/9/12개월 누적 수치를 분기 실적으로 오인하지 않는다. EPS는 누적값을 빼서 만들 수 없다.
export function parseSec(payload, source, today) {
  if (!payload?.facts || String(payload.cik).padStart(10, "0") !== source.cik) throw new Error("SEC 기업 식별자 또는 응답 형식 불일치");
  return Object.entries(SEC_TAGS).map(([id, tags]) => {
    const choices = [];
    for (const [namespace, tag] of tags) {
      const units = payload.facts[namespace]?.[tag]?.units ?? {};
      for (const [unit, facts] of Object.entries(units)) {
        if (!(id === "eps" ? /^[A-Z]{3}\/shares$/.test(unit) : /^[A-Z]{3}$/.test(unit)) || !Array.isArray(facts)) continue;
        const rows = facts.filter((r) => finite(r.val) && /^\d{4}-\d{2}-\d{2}$/.test(r.start ?? "") &&
          /^\d{4}-\d{2}-\d{2}$/.test(r.end ?? "") && /^\d{4}-\d{2}-\d{2}$/.test(r.filed ?? "") &&
          r.filed <= today && days(r.start, r.end) >= 70 && days(r.start, r.end) <= 105 &&
          /^(10-Q|10-K|20-F|40-F|6-K|8-K)(\/A)?$/.test(r.form ?? ""))
          .sort((a, b) => b.end.localeCompare(a.end) || b.filed.localeCompare(a.filed));
        const current = rows.find((r) => r.end.startsWith(source.period));
        const previous = rows.find((r) => r.end.startsWith(shiftMonth(source.period, -3)));
        const yearAgo = rows.find((r) => r.end.startsWith(shiftMonth(source.period, -12)));
        if (current || previous || yearAgo) choices.push({ namespace, tag, unit, current, previous, yearAgo });
      }
    }
    // 현 기간 자료가 있는 태그를 우선하고 같은 태그·통화끼리만 비교한다.
    choices.sort((a, b) => Number(Boolean(b.current)) - Number(Boolean(a.current)) || Number(Boolean(b.previous)) - Number(Boolean(a.previous)));
    const choice = choices[0];
    const point = (row) => row ? { value: row.val, period: `${row.start} ~ ${row.end}` } : null;
    return metric(id, id === "eps" ? "희석 주당순이익(EPS)" : "분기 매출",
      choice?.unit.replace("/shares", "/주") ?? (id === "eps" ? "USD/주" : "USD"),
      choice ? `${choice.namespace === "us-gaap" ? "GAAP" : "IFRS"} · ${choice.tag}` : "표준 분기 공시 대기",
      point(choice?.current), point(choice?.previous), point(choice?.yearAgo));
  });
}

export function makeResult(event, metrics, now, old) {
  const source = event.resultSource;
  const checkedAt = now.toISOString();
  const same = old?.sourceKey === sourceKey(source);
  // HTTP 200이라도 이미 확인한 결과가 빠진 불완전 응답은 성공으로 덮어쓰지 않는다.
  if (same && metrics.length && old.metrics.some((before) => before.actual !== null &&
    !metrics.some((row) => row.id === before.id && row.actual !== null))) {
    throw new Error("이미 수집한 결과가 원천 응답에서 누락됨");
  }
  const enriched = metrics.map((row) => {
    const before = same ? old.metrics.find((m) => m.id === row.id && m.unit === row.unit && m.basis === row.basis) : null;
    return { ...row, firstObserved: before?.firstObserved ?? row.actual,
      firstObservedAt: before?.firstObservedAt ?? (row.actual !== null ? checkedAt : null) };
  });
  const count = enriched.filter((r) => r.actual !== null).length;
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(now);
  const status = count === metrics.length ? "available" : count ? "partial" : event.date > today ? "pending" : "unavailable";
  return { sourceKey: sourceKey(source), provider: source.provider, period: source.period,
    sourceUrl: source.provider === "bls" ? "https://www.bls.gov/news.release/empsit.htm" : `https://www.sec.gov/edgar/browse/?CIK=${source.cik}&owner=exclude`,
    checkedAt, lastSuccessAt: checkedAt, status, metrics: enriched,
    message: source.provider === "bls" ? "공식 데이터 반영에는 지연이 있을 수 있습니다. 최초 수집값은 최초 발표치와 다를 수 있습니다." :
      "SEC 표준 분기 공시 기준 · 조정 EPS 아님 · 공시 지연/미지원 항목은 빈칸 · 외국기업 EPS는 ADR 기준과 다를 수 있습니다." };
}

export function failedResult(event, now, old, message) {
  const result = makeResult(event, [], now);
  const previous = old?.sourceKey === result.sourceKey ? old : null;
  return { ...result, metrics: previous?.metrics ?? [], lastSuccessAt: previous?.lastSuccessAt ?? null,
    status: "error", message: `${message}. 기존에 수집한 값은 유지하며 다음 주기에 재시도합니다.` };
}
