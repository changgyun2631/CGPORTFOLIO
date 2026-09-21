import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// server-only는 Next.js 번들러 바깥(=이 테스트가 도는 순수 Node)에서 그냥 import만
// 해도 무조건 throw하도록 만들어진 패키지다 — 서버 컴포넌트/액션에서만 쓰이게
// 강제하는 장치. 테스트에서는 빈 모듈로 바꿔서 그 체크를 우회한다.
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

// backupData를 감싸서 딱 한 번만 실패를 주입할 수 있게 한다 — "백업 단계에서
// 예기치 못한 오류가 나도 데이터는 안 바뀌고 재시도 토큰을 받는다"를 검증하려는
// 용도. 평소에는 실제 구현 그대로 통과시킨다.
let backupShouldThrowOnce = false;
vi.mock("../../../scripts/lib/backup.mjs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../scripts/lib/backup.mjs")>();
  return {
    ...actual,
    backupData: (...args: Parameters<typeof actual.backupData>) => {
      if (backupShouldThrowOnce) {
        backupShouldThrowOnce = false;
        throw new Error("시뮬레이션된 백업 실패");
      }
      return actual.backupData(...args);
    },
  };
});

const { applyPositionBasis, previewPositionBasis } = await import("../position-basis-actions");
const { MAX_FILE_BYTES } = await import("../limits");

// "종목명,코드,보유량,매입가,매입금액,평가금액,평가손익,수수료" 줄 하나를 EUC-KR로
// 인코딩한 바이트(WORK_ORDER P1-7 검증 때 PowerShell [System.Text.Encoding]::GetEncoding(51949)로
// 직접 만들어 확인한 값과 같은 인코딩 결과)를 base64로 고정해 뒀다 — Node에는
// EUC-KR 인코더가 없어서 테스트 안에서 직접 만들 수 없기 때문이다.
const EUCKR_HEADER_B64 = "wb648bjtLMTateUsurjAr7euLLjFwNSwoSy4xcDUsd2+1yzG8rChsd2+1yzG8rChvNXAzSy89rz2t+E=";

function positionBasisCsv(rows: string[]): File {
  const headerBytes = Buffer.from(EUCKR_HEADER_B64, "base64");
  const rowBytes = Buffer.from(`\n${rows.join("\n")}`, "ascii"); // 데이터 행은 계좌ID·심볼ID·숫자만 써서 아스키로 충분하다
  return new File([headerBytes, rowBytes], "basis.csv", { type: "text/csv" });
}

function writeFixtures(dir: string) {
  writeFileSync(
    join(dir, "accounts.json"),
    JSON.stringify([
      { id: "acc-1", name: "테스트", kind: "위탁", currency: "USD" },
      { id: "acc-2", name: "테스트2", kind: "위탁", currency: "USD" },
    ]),
  );
  writeFileSync(
    join(dir, "symbols.json"),
    JSON.stringify([{ id: "QLD", name: "QLD", kind: "etf", currency: "USD", market: "US" }]),
  );
  writeFileSync(join(dir, "transactions.json"), JSON.stringify([]));
  writeFileSync(join(dir, "cashflows.json"), JSON.stringify([]));
}

describe("position-basis-actions", () => {
  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), "import-actions-data-"));
    backupRoot = mkdtempSync(join(tmpdir(), "import-actions-backup-"));
    writeFixtures(dataDir);
  });

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(backupRoot, { recursive: true, force: true });
  });

  it("정상 CSV는 미리보기를 통과하고, 적용하면 실제로 파일이 써지고 백업이 만들어진다", async () => {
    const form = new FormData();
    form.set("accountId", "acc-1");
    form.set("file", positionBasisCsv(["test,QLD,10,1000,10000,12000,1998,2"]));

    const preview = await previewPositionBasis(form);
    expect(preview.validationErrors).toEqual([]);
    expect(preview.crossCheck.ok).toBe(true);

    const result = await applyPositionBasis(preview.token);
    expect(result.ok).toBe(true);

    const written = JSON.parse(readFileSync(join(dataDir, "position-basis.json"), "utf8"));
    expect(written).toHaveLength(1);
    expect(written[0].symbolId).toBe("QLD");

    // 적용 직전 자동 백업이 실제로 만들어졌는지.
    const backups = readdirSync(backupRoot);
    expect(backups.length).toBeGreaterThan(0);
  });

  it("다른 계좌의 기준값은 건드리지 않는다 — 올린 계좌 줄만 갈아끼운다", async () => {
    // 한 계좌 CSV로 파일 전체를 덮어써서 다른 계좌 보유가 통째로 날아간 적이 있다(2026-09-21).
    writeFileSync(
      join(dataDir, "position-basis.json"),
      JSON.stringify([
        { at: "2026-01-01T00:00:00Z", accountId: "acc-2", symbolId: "QLD", shares: 5, averagePrice: 100, costBasis: 500 },
      ]),
    );

    const form = new FormData();
    form.set("accountId", "acc-1");
    form.set("file", positionBasisCsv(["test,QLD,10,1000,10000,12000,1998,2"]));
    const preview = await previewPositionBasis(form);
    expect(await applyPositionBasis(preview.token)).toMatchObject({ ok: true });

    const written = JSON.parse(readFileSync(join(dataDir, "position-basis.json"), "utf8"));
    const byAccount = Object.fromEntries(
      ["acc-1", "acc-2"].map((id) => [id, written.filter((row: { accountId: string }) => row.accountId === id)]),
    );
    expect(byAccount["acc-2"]).toHaveLength(1); // 남의 계좌는 그대로
    expect(byAccount["acc-2"][0].shares).toBe(5);
    expect(byAccount["acc-1"]).toHaveLength(1); // 올린 계좌만 새 값
  });

  it("같은 계좌를 다시 올리면 이전 값을 대체한다(중복으로 쌓이지 않는다)", async () => {
    writeFileSync(
      join(dataDir, "position-basis.json"),
      JSON.stringify([
        { at: "2026-01-01T00:00:00Z", accountId: "acc-1", symbolId: "QLD", shares: 999, averagePrice: 1, costBasis: 999 },
      ]),
    );

    const form = new FormData();
    form.set("accountId", "acc-1");
    form.set("file", positionBasisCsv(["test,QLD,10,1000,10000,12000,1998,2"]));
    const preview = await previewPositionBasis(form);
    expect(await applyPositionBasis(preview.token)).toMatchObject({ ok: true });

    const written = JSON.parse(readFileSync(join(dataDir, "position-basis.json"), "utf8"));
    expect(written).toHaveLength(1);
    expect(written[0].shares).toBe(10);
  });

  it("클라이언트가 검증 실패 상태로 apply를 직접 불러도(우회 시도) 서버가 막고 기존 데이터를 보존한다", async () => {
    const form = new FormData();
    form.set("accountId", "ghost-account"); // accounts.json에 없는 계좌
    form.set("file", positionBasisCsv(["test,QLD,10,1000,10000,12000,1998,2"]));

    const preview = await previewPositionBasis(form);
    expect(preview.validationErrors.length).toBeGreaterThan(0); // 미리보기 단계에서도 이미 걸림

    // 화면이라면 이 토큰으로 적용 버튼이 비활성화되지만, 여기서는 클라이언트를
    // 우회해 서버 액션을 직접 불러 "그래도 막히는지"를 확인한다.
    const result = await applyPositionBasis(preview.token);
    expect(result.ok).toBe(false);

    expect(existsSync(join(dataDir, "position-basis.json"))).toBe(false);
  });

  it("같은 토큰으로 두 번 적용하면 두 번째는 거부된다(재실행/중복 업로드 방지)", async () => {
    const form = new FormData();
    form.set("accountId", "acc-1");
    form.set("file", positionBasisCsv(["test,QLD,10,1000,10000,12000,1998,2"]));

    const preview = await previewPositionBasis(form);
    const first = await applyPositionBasis(preview.token);
    expect(first.ok).toBe(true);

    const second = await applyPositionBasis(preview.token);
    expect(second.ok).toBe(false);
  });

  it("파일이 크기 한도를 넘으면 미리보기가 거부된다", async () => {
    const form = new FormData();
    form.set("accountId", "acc-1");
    const huge = new File([new Uint8Array(MAX_FILE_BYTES + 1)], "huge.csv", { type: "text/csv" });
    form.set("file", huge);

    await expect(previewPositionBasis(form)).rejects.toThrow("너무 큽니다");
  });

  it(".csv가 아닌 파일은 미리보기가 거부된다", async () => {
    const form = new FormData();
    form.set("accountId", "acc-1");
    form.set("file", new File([Buffer.from("아무 내용")], "basis.xlsx", { type: "application/octet-stream" }));

    await expect(previewPositionBasis(form)).rejects.toThrow(".csv 파일만 지원합니다");
  });

  it("존재하지 않는 토큰으로 적용을 시도하면 거부된다", async () => {
    const result = await applyPositionBasis("00000000-0000-0000-0000-000000000000");
    expect(result.ok).toBe(false);
  });

  it("미리보기 이후 검증에 쓰는 파일이 바뀌면 적용이 거부되고 기존 기준값이 보존된다", async () => {
    const form = new FormData();
    form.set("accountId", "acc-1");
    form.set("file", positionBasisCsv(["test,QLD,10,1000,10000,12000,1998,2"]));
    const preview = await previewPositionBasis(form);

    // 미리보기 이후 다른 프로세스(예: 원장 정규화)가 transactions.json을 바꿨다고 가정한다.
    writeFileSync(
      join(dataDir, "transactions.json"),
      JSON.stringify([{ id: "tx-new", at: "2026-01-01T00:00:00Z", accountId: "acc-1", symbolId: "QLD", side: "buy", shares: 1, price: 1 }]),
    );

    const result = await applyPositionBasis(preview.token);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]).toContain("미리보기 이후 데이터가 바뀌었습니다");
    expect(existsSync(join(dataDir, "position-basis.json"))).toBe(false);
  });

  it("백업 단계에서 예기치 못한 오류가 나면 데이터는 안 바뀌고, retryToken으로 재업로드 없이 재시도할 수 있다", async () => {
    const form = new FormData();
    form.set("accountId", "acc-1");
    form.set("file", positionBasisCsv(["test,QLD,10,1000,10000,12000,1998,2"]));
    const preview = await previewPositionBasis(form);

    backupShouldThrowOnce = true;
    const failed = await applyPositionBasis(preview.token);
    expect(failed.ok).toBe(false);
    expect(existsSync(join(dataDir, "position-basis.json"))).toBe(false); // 백업 전에 실패했으니 아직 안 바뀜
    if (failed.ok) throw new Error("unreachable");
    expect(failed.errors[0]).toContain("반영 중 오류가 발생했습니다");
    expect(failed.retryToken).toBeTruthy();

    // 원래 토큰은 이미 소모됐으니 재사용하면 거부된다.
    const reuseOriginal = await applyPositionBasis(preview.token);
    expect(reuseOriginal.ok).toBe(false);

    // retryToken으로는(백업이 이번엔 정상 동작하므로) 재업로드 없이 그대로 성공한다.
    const retried = await applyPositionBasis(failed.retryToken!);
    expect(retried.ok).toBe(true);
    expect(existsSync(join(dataDir, "position-basis.json"))).toBe(true);
  });

  it("WORK_ORDER B-0A-2: 같은 baseline에서 미리보기 두 개를 만들면 첫 적용만 성공하고 두 번째는 거부된다", async () => {
    // position-basis.json이 baseline에 없던 이전 버전에서는, 둘 다 "미리보기
    // 이후 아무것도 안 바뀜"으로 통과해 preview B가 preview A의 결과를 조용히
    // 덮어쓸 수 있었다 — target 파일 자체를 baseline에 넣어 막는다.
    const formA = new FormData();
    formA.set("accountId", "acc-1");
    formA.set("file", positionBasisCsv(["test,QLD,10,1000,10000,12000,1998,2"]));
    const previewA = await previewPositionBasis(formA);

    const formB = new FormData();
    formB.set("accountId", "acc-1");
    formB.set("file", positionBasisCsv(["test,QLD,20,1000,20000,24000,3996,2"]));
    const previewB = await previewPositionBasis(formB);

    const applyA = await applyPositionBasis(previewA.token);
    expect(applyA.ok).toBe(true);

    const applyB = await applyPositionBasis(previewB.token);
    expect(applyB.ok).toBe(false);
    if (applyB.ok) throw new Error("unreachable");
    expect(applyB.errors[0]).toContain("미리보기 이후 데이터가 바뀌었습니다");

    // A가 반영한 값이 B에 덮이지 않고 그대로 남아 있어야 한다.
    const written = JSON.parse(readFileSync(join(dataDir, "position-basis.json"), "utf8"));
    expect(written[0].shares).toBe(10);
  });
});
