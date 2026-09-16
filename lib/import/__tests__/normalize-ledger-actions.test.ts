import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

const { applyNormalizeLedger, previewNormalizeLedger } = await import("../normalize-ledger-actions");

function writeFixtures(dir: string) {
  writeFileSync(dir + "/accounts.json", JSON.stringify([{ id: "acc-1", name: "테스트", kind: "위탁", currency: "USD" }]));
  writeFileSync(dir + "/symbols.json", JSON.stringify([{ id: "QLD", name: "QLD", kind: "etf", currency: "USD", market: "US" }]));
  writeFileSync(
    dir + "/transactions.json",
    JSON.stringify([
      { id: "tx-1", at: "2026-01-01T00:00:00Z", accountId: "acc-1", symbolId: "QLD", side: "buy", shares: 1, price: 100, note: "이체입고" },
    ]),
  );
  writeFileSync(
    dir + "/cashflows.json",
    JSON.stringify([{ id: "cf-1", at: "2026-01-01T00:00:00Z", accountId: "acc-1", type: "deposit", amount: 0, currency: "USD", note: "원장 재구성 보정" }]),
  );
}

describe("normalize-ledger-actions", () => {
  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), "import-actions-data-"));
    backupRoot = mkdtempSync(join(tmpdir(), "import-actions-backup-"));
    writeFixtures(dataDir);
  });

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(backupRoot, { recursive: true, force: true });
  });

  it("미리보기가 이체 거래를 action: transfer로 정규화하고, 적용하면 실제 파일이 바뀐다", async () => {
    const preview = await previewNormalizeLedger();
    expect(preview.validationErrors).toEqual([]);
    expect(preview.transactionCount).toBe(1);

    const result = await applyNormalizeLedger(preview.token);
    expect(result.ok).toBe(true);

    const written = JSON.parse(readFileSync(join(dataDir, "transactions.json"), "utf8"));
    expect(written[0].action).toBe("transfer");
  });

  it("같은 토큰으로 두 번 적용하면 두 번째는 거부된다", async () => {
    const preview = await previewNormalizeLedger();
    const first = await applyNormalizeLedger(preview.token);
    expect(first.ok).toBe(true);
    const second = await applyNormalizeLedger(preview.token);
    expect(second.ok).toBe(false);
  });

  it("적용을 안 하면(취소) 기존 원장은 그대로다", async () => {
    const before = readFileSync(join(dataDir, "transactions.json"), "utf8");
    await previewNormalizeLedger(); // 미리보기만 하고 적용은 호출하지 않는다
    const after = readFileSync(join(dataDir, "transactions.json"), "utf8");
    expect(after).toBe(before);
  });
});
