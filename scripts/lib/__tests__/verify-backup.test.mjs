import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const scriptPath = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "verify-backup.mjs");

const accounts = [{ id: "acc-1", name: "테스트계좌", kind: "위탁", currency: "USD" }];
const symbols = [{ id: "QLD", name: "QLD", kind: "etf", currency: "USD", market: "US" }];

function writeValidBackup(dir) {
  writeFileSync(join(dir, "accounts.json"), JSON.stringify(accounts));
  writeFileSync(join(dir, "symbols.json"), JSON.stringify(symbols));
  writeFileSync(
    join(dir, "transactions.json"),
    JSON.stringify([
      { id: "tx-1", at: "2026-01-05T00:00:00Z", accountId: "acc-1", symbolId: "QLD", side: "buy", shares: 10, price: 100 },
    ]),
  );
  writeFileSync(
    join(dir, "cashflows.json"),
    JSON.stringify([
      { id: "cf-1", at: "2026-01-01T00:00:00Z", accountId: "acc-1", type: "deposit", amount: 1000, currency: "USD" },
    ]),
  );
  writeFileSync(join(dir, "dividends.json"), JSON.stringify([]));
  writeFileSync(
    join(dir, "snapshots.json"),
    JSON.stringify([{ at: "2026-01-01T00:00:00Z", totalKrw: 1_000_000, fxRate: 1300 }]),
  );
  writeFileSync(join(dir, "quotes.json"), JSON.stringify([]));
  writeFileSync(join(dir, "fx-quote.json"), JSON.stringify({ pair: "USD/KRW", rate: 1300, prevRate: 1290, asOf: "2026-01-01T00:00:00Z" }));
}

function run(args) {
  try {
    const stdout = execFileSync(process.execPath, [scriptPath, ...args], { encoding: "utf8" });
    return { status: 0, stdout, stderr: "" };
  } catch (error) {
    return { status: error.status, stdout: error.stdout, stderr: error.stderr };
  }
}

describe("verify-backup.mjs", () => {
  let sourceDir;
  afterEach(() => {
    if (sourceDir) rmSync(sourceDir, { recursive: true, force: true });
  });

  it("정상 백업은 리허설을 통과하고, 원본 백업 폴더는 건드리지 않는다", () => {
    sourceDir = mkdtempSync(join(tmpdir(), "backup-fixture-"));
    writeValidBackup(sourceDir);
    const before = readdirSync(sourceDir).sort();

    const result = run([sourceDir]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("리허설 통과");
    expect(readdirSync(sourceDir).sort()).toEqual(before);
  });

  it("필수 파일이 빠지면 실패한다", () => {
    sourceDir = mkdtempSync(join(tmpdir(), "backup-fixture-"));
    writeValidBackup(sourceDir);
    rmSync(join(sourceDir, "quotes.json"));

    const result = run([sourceDir]);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("백업에 없음");
  });

  it("JSON이 깨져 있으면 실패한다", () => {
    sourceDir = mkdtempSync(join(tmpdir(), "backup-fixture-"));
    writeValidBackup(sourceDir);
    writeFileSync(join(sourceDir, "transactions.json"), "{ 이건 JSON이 아님");

    const result = run([sourceDir]);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("JSON 파싱 실패");
  });

  it("참조 무결성이 깨지면(존재하지 않는 계좌) 실패한다", () => {
    sourceDir = mkdtempSync(join(tmpdir(), "backup-fixture-"));
    writeValidBackup(sourceDir);
    writeFileSync(
      join(sourceDir, "transactions.json"),
      JSON.stringify([
        { id: "tx-1", at: "2026-01-05T00:00:00Z", accountId: "acc-ghost", symbolId: "QLD", side: "buy", shares: 10, price: 100 },
      ]),
    );

    const result = run([sourceDir]);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("accountId");
  });
});
