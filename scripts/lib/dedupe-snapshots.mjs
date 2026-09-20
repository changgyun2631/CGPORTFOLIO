/**
 * 이미 저장된 `data/snapshots.json`에서, 연속으로 값이 완전히 같은 점들을
 * 각 구간의 첫 점만 남기고 지운다. 주말·휴장에는 6시간마다 조회해도 시세가
 * 안 바뀐 채 그대로 다시 찍혀서, 그 구간이 인덱스 기준 차트에서 실제 거래일보다
 * 훨씬 넓은 평평한 자리를 차지했다(2026-09-21 사용자 보고).
 *
 * 과거 스냅샷은 보유 종목별 시세를 따로 남기지 않아서 `/api/cron/refresh`의
 * 새 기준(보유 종목 시세 일치)을 그대로 되짚을 수 없다 — 대신 `totalKrw`·
 * `principalKrw`가 직전 남긴 점과 완전히 같은지로 판단한다(`fxRate`는 뺀다 —
 * 주말에도 수시로 바뀌어서 포함하면 진짜 중복인데도 놓칠 수 있다).
 *
 * @param {{at: string, totalKrw: number, principalKrw?: number, fxRate: number}[]} snapshots
 */
export function dedupeFlatSnapshots(snapshots) {
  const kept = [];
  for (const snapshot of snapshots) {
    const previous = kept.at(-1);
    const flat = previous != null && previous.totalKrw === snapshot.totalKrw && previous.principalKrw === snapshot.principalKrw;
    if (!flat) kept.push(snapshot);
  }
  return kept;
}

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

function isWeekendKst(iso) {
  const day = new Date(Date.parse(iso) + KST_OFFSET_MS).getUTCDay();
  return day === 0 || day === 6; // 일요일=0, 토요일=6
}

/**
 * `dedupeFlatSnapshots`만으로는 못 잡는 주말 중복을 지운다. 실제로 확인해보니
 * 공급자가 휴장 중에도 시세를 소수점 단위로 미세하게 다시 찍는 경우가 있어서,
 * `totalKrw`가 매번 조금씩 달라져 "완전히 같음" 기준을 피해 갔다
 * (2026-09-21 재확인 — `dedupeFlatSnapshots`만 돌렸을 때 주말 내내 거의 매
 * 시각이 남아있었다). 대신 시각(KST) 자체로 판단한다 — 토요일·일요일에는
 * 국내·미국 어느 시장도 안 열리므로, 같은 주말 구간의 첫 점만 남기고 나머지는
 * 값과 무관하게 지운다. 공휴일은 고려하지 않는다(이 프로젝트의 다른 곳과
 * 같은 근사 — `lib/domain/freshness.ts` 참고).
 *
 * @param {{at: string, [key: string]: unknown}[]} snapshots
 */
export function dedupeWeekendRuns(snapshots) {
  const kept = [];
  let inWeekendRun = false;
  for (const snapshot of snapshots) {
    const weekend = isWeekendKst(snapshot.at);
    if (weekend && inWeekendRun) continue; // 같은 주말 구간의 후속 점은 값과 무관하게 지운다
    kept.push(snapshot);
    inWeekendRun = weekend;
  }
  return kept;
}
