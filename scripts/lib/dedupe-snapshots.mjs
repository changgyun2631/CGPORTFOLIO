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
