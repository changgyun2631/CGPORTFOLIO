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

// renameSync만 spy로 바꿔서 회차별로 실패를 주입한다(generation-write.test.ts와
// 같은 기법) — transactions.json/cashflows.json 두 파일 쓰기 중 두 번째가
// 실패했을 때 첫 번째가 롤백되는지 확인하려는 용도.
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, renameSync: vi.fn(actual.renameSync) };
});

const { applyNormalizeLedger, previewNormalizeLedger } = await import("../normalize-ledger-actions");
const fsNode = await import("node:fs");
const actualFs = await vi.importActual<typeof import("node:fs")>("node:fs");

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
    vi.mocked(fsNode.renameSync).mockReset();
    vi.mocked(fsNode.renameSync).mockImplementation((...args: Parameters<typeof fsNode.renameSync>) => actualFs.renameSync(...args));
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

  it("미리보기 이후 cashflows.json이 바뀌면 적용이 거부되고 그 변경이 보존된다", async () => {
    const preview = await previewNormalizeLedger();

    const externalCashflows = [
      { id: "cf-external", at: "2026-02-01T00:00:00Z", accountId: "acc-1", type: "deposit", amount: 100, currency: "USD", note: "다른 작업이 씀" },
    ];
    writeFileSync(join(dataDir, "cashflows.json"), JSON.stringify(externalCashflows));

    const result = await applyNormalizeLedger(preview.token);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]).toContain("미리보기 이후 데이터가 바뀌었습니다");

    const stillExternal = JSON.parse(readFileSync(join(dataDir, "cashflows.json"), "utf8"));
    expect(stillExternal).toEqual(externalCashflows);
  });

  it("cashflows.json 쓰기(두 번째)가 실패하면 이미 쓴 transactions.json이 원본으로 롤백되고, retryToken으로 재업로드 없이 재시도할 수 있다", async () => {
    const preview = await previewNormalizeLedger();
    const originalTransactions = readFileSync(join(dataDir, "transactions.json"), "utf8");

    // transactions.json이 1번째 rename, cashflows.json이 2번째 — 2번째에서만 실패시킨다.
    let call = 0;
    vi.mocked(fsNode.renameSync).mockImplementation((...args: Parameters<typeof fsNode.renameSync>) => {
      call += 1;
      if (call === 2) throw new Error("시뮬레이션된 두 번째 파일 쓰기 실패");
      return actualFs.renameSync(...args);
    });

    const failed = await applyNormalizeLedger(preview.token);
    expect(failed.ok).toBe(false);
    if (failed.ok) throw new Error("unreachable");
    expect(failed.errors[0]).toContain("반영 중 오류가 발생했습니다");
    expect(failed.retryToken).toBeTruthy();

    // 롤백 확인 — transactions.json이 정규화된 새 값이 아니라 원래 내용 그대로.
    expect(readFileSync(join(dataDir, "transactions.json"), "utf8")).toBe(originalTransactions);

    // rename이 다시 정상 동작하는 상태에서 retryToken으로 재시도하면 성공한다.
    vi.mocked(fsNode.renameSync).mockImplementation((...args: Parameters<typeof fsNode.renameSync>) => actualFs.renameSync(...args));
    const retried = await applyNormalizeLedger(failed.retryToken!);
    expect(retried.ok).toBe(true);

    const written = JSON.parse(readFileSync(join(dataDir, "transactions.json"), "utf8"));
    expect(written[0].action).toBe("transfer");
  });
});
