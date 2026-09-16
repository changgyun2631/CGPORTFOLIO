import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

let dataDir: string;
let backupRoot: string;

vi.mock("../paths", () => ({
  get dataDir() {
    return dataDir;
  },
  get backupRoot() {
    return backupRoot;
  },
}));

const { applyAccountHistory, previewAccountHistory } = await import("../account-history-actions");

// "일자,예탁자산,입금,출금" 헤더를 EUC-KR로 인코딩한 바이트의 base64 — Node에는
// EUC-KR 인코더가 없어서 PowerShell [System.Text.Encoding]::GetEncoding(51949)로
// 미리 만들어 둔 고정 테스트 벡터다.
const EUCKR_HEADER_B64 = "wM/A2iy/ucW5wNq76izA1LHdLMPisd0=";

function accountHistoryCsv(rows: string[]): File {
  const headerBytes = Buffer.from(EUCKR_HEADER_B64, "base64");
  const rowBytes = Buffer.from(`\n${rows.join("\n")}`, "ascii"); // 데이터 행은 날짜·숫자만 써서 아스키로 충분하다
  return new File([headerBytes, rowBytes], "history.csv", { type: "text/csv" });
}

function writeFixtures(dir: string) {
  writeFileSync(join(dir, "fx.json"), JSON.stringify([{ d: "2026-01-01", rate: 1300 }]));
  writeFileSync(join(dir, "snapshots.json"), JSON.stringify([]));
  writeFileSync(join(dir, "cashflows.json"), JSON.stringify([]));
}

describe("account-history-actions", () => {
  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), "import-actions-data-"));
    backupRoot = mkdtempSync(join(tmpdir(), "import-actions-backup-"));
    writeFixtures(dataDir);
  });

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(backupRoot, { recursive: true, force: true });
  });

  it("정상 CSV는 미리보기를 통과하고, 적용하면 실제로 스냅샷이 반영된다", async () => {
    const form = new FormData();
    form.append("files", accountHistoryCsv(["2026-01-01,1000000,1000000,0", "2026-01-02,1050000,0,0"]));

    const preview = await previewAccountHistory(form);
    expect(preview.validationErrors).toEqual([]);
    expect(preview.dayCount).toBe(2);

    const result = await applyAccountHistory(preview.token);
    expect(result.ok).toBe(true);

    const written = JSON.parse(readFileSync(join(dataDir, "snapshots.json"), "utf8"));
    expect(written).toHaveLength(2);
  });

  it("여러 파일 중 하나라도 헤더를 못 찾으면 전체가 실패하고 기존 데이터가 보존된다", async () => {
    const form = new FormData();
    form.append("files", accountHistoryCsv(["2026-01-01,1000000,1000000,0"]));
    form.append("files", new File([Buffer.from("이상한,헤더\n1,2")], "broken.csv", { type: "text/csv" }));

    await expect(previewAccountHistory(form)).rejects.toThrow("헤더를 찾지 못했습니다");
    expect(existsSync(join(dataDir, "out-snapshots.json"))).toBe(false);

    // 미리보기 자체가 실패했으니 반영할 것도 없다 — 기존 스냅샷은 그대로다.
    const stillOriginal = JSON.parse(readFileSync(join(dataDir, "snapshots.json"), "utf8"));
    expect(stillOriginal).toEqual([]);
  });

  it("파일을 하나도 안 주면 미리보기가 거부된다", async () => {
    const form = new FormData();
    await expect(previewAccountHistory(form)).rejects.toThrow();
  });

  it("같은 토큰으로 두 번 적용하면 두 번째는 거부된다", async () => {
    const form = new FormData();
    form.append("files", accountHistoryCsv(["2026-01-01,1000000,1000000,0"]));
    const preview = await previewAccountHistory(form);

    const first = await applyAccountHistory(preview.token);
    expect(first.ok).toBe(true);
    const second = await applyAccountHistory(preview.token);
    expect(second.ok).toBe(false);
  });

  it("미리보기 이후 cron이 새 스냅샷을 추가하면 적용이 거부되고 cron이 쌓은 값이 보존된다", async () => {
    const form = new FormData();
    form.append("files", accountHistoryCsv(["2026-01-01,1000000,1000000,0"]));
    const preview = await previewAccountHistory(form);

    // 미리보기 이후, 병합 대상이던 snapshots.json을 cron이 건드렸다고 가정한다.
    const cronSnapshot = [{ at: "2026-01-01T20:00:00Z", accountId: "acc-1", totalKrw: 1234567 }];
    writeFileSync(join(dataDir, "snapshots.json"), JSON.stringify(cronSnapshot));

    const result = await applyAccountHistory(preview.token);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]).toContain("미리보기 이후 데이터가 바뀌었습니다");

    // 거부됐으니 cron이 쓴 값이 staged 병합 결과로 덮어써지지 않고 그대로 남아 있어야 한다.
    const stillCron = JSON.parse(readFileSync(join(dataDir, "snapshots.json"), "utf8"));
    expect(stillCron).toEqual(cronSnapshot);
  });
});
