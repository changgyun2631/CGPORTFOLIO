import { fxRateAt } from "./import-account-history.mjs";

/**
 * 저장된 스냅샷들의 `fxRate`만 실제 과거 환율로 다시 채운다. `totalKrw`·
 * `principalKrw`는 계좌수익률 CSV의 예탁자산을 그대로 쓴 값이라 원래도
 * 정확했으므로 건드리지 않는다 — 잘못됐던 건 `fx.json`(당시엔 가짜 데이터)에서
 * 날짜별로 가져오던 `fxRate` 필드뿐이다.
 *
 * @param {{at: string, fxRate: number, [key: string]: unknown}[]} snapshots
 * @param {{d: string, rate: number}[]} fxHistory
 */
export function fixSnapshotFxRates(snapshots, fxHistory) {
  const sorted = [...fxHistory].sort((a, b) => a.d.localeCompare(b.d));
  return snapshots.map((snapshot) => ({
    ...snapshot,
    fxRate: fxRateAt(sorted, snapshot.at.slice(0, 10)),
  }));
}
