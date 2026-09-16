import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// 실제 로그 폴더(~/cgportfolio-logs/)를 건드리지 않는다.
vi.mock("@/lib/data/cron-log", () => ({ logCronStage: vi.fn() }));

// 실제 API를 부르지 않는다. fetchAllQuotes는 "외부 조회 중 다른 프로세스가 data/를
// 바꾼" 상황을 흉내내는 부수효과를 가진 채로 각 테스트에서 다시 정의한다.
const fetchAllQuotes = vi.fn();
const buildFxProvider = vi.fn((): null => null);
vi.mock("@/lib/providers", () => ({
  fetchAllQuotes: (symbols: unknown) => fetchAllQuotes(symbols),
  buildFxProvider: () => buildFxProvider(),
}));

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "cron-route-"));
  mkdirSync(join(root, "data"));
  vi.spyOn(process, "cwd").mockReturnValue(root);
  vi.stubEnv("CRON_SECRET", "");
  vi.resetModules();
  fetchAllQuotes.mockReset();
  buildFxProvider.mockReset().mockReturnValue(null);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
});

function writeFixtures(overrides: { transactions?: unknown[] } = {}) {
  const dataDir = join(root, "data");
  const account = { id: "acc1", name: "위탁", kind: "위탁", currency: "KRW" };
  const symbol = { id: "QLD", name: "QLD", kind: "etf", currency: "USD", market: "US" };
  const baseTx = { id: "tx-1", at: "2024-01-01T00:00:00+09:00", accountId: "acc1", symbolId: "QLD", side: "buy", shares: 1, price: 100 };

  writeFileSync(join(dataDir, "accounts.json"), JSON.stringify([account]));
  writeFileSync(join(dataDir, "symbols.json"), JSON.stringify([symbol]));
  writeFileSync(join(dataDir, "transactions.json"), JSON.stringify(overrides.transactions ?? [baseTx]));
  writeFileSync(join(dataDir, "cashflows.json"), JSON.stringify([]));
  writeFileSync(join(dataDir, "dividends.json"), JSON.stringify([]));
  writeFileSync(join(dataDir, "quotes.json"), JSON.stringify([{ symbolId: "QLD", price: 100, currency: "USD", asOf: "2024-01-01T00:00:00Z" }]));
  writeFileSync(
    join(dataDir, "fx-quote.json"),
    JSON.stringify({ pair: "USD/KRW", rate: 1300, prevRate: 1290, asOf: "2024-01-01T00:00:00Z" }),
  );
  writeFileSync(join(dataDir, "snapshots.json"), JSON.stringify([]));
  writeFileSync(join(dataDir, "lookthrough.json"), JSON.stringify({}));
  writeFileSync(join(dataDir, "fx.json"), JSON.stringify([{ d: "2024-01-01", rate: 1300 }]));

  return { dataDir, baseTx };
}

describe("GET /api/cron/refresh", () => {
  it("정상 흐름: 새 시세로 스냅샷 한 점을 쌓는다", async () => {
    writeFixtures();
    fetchAllQuotes.mockResolvedValue({
      quotes: [{ symbolId: "QLD", price: 110, currency: "USD", asOf: "2024-01-02T00:00:00Z" }],
      missing: [],
      errors: [],
    });

    const { GET } = await import("../route");
    const response = await GET(new Request("http://localhost/api/cron/refresh"));
    const body = await response.json();

    expect(body.ok).toBe(true);
    const snapshots = JSON.parse(readFileSync(join(root, "data", "snapshots.json"), "utf8"));
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].totalKrw).toBeCloseTo(1 * 110 * 1300); // 1주 * 새 시세 110 * 환율 1300
  });

  it("WORK_ORDER B-0A-3: 외부 시세 조회 중 다른 프로세스가 잔고를 바꾸면, 잠금 안에서 다시 읽은 최신 값으로 계산한다", async () => {
    const { dataDir, baseTx } = writeFixtures();

    // fetchAllQuotes가 응답하는 "동안"(실제로는 그 호출의 부수효과로 흉내낸다)
    // 다른 프로세스(예: 원장 정규화 import)가 transactions.json에 거래를
    // 하나 더 추가했다고 가정한다 — 보유수량이 1주 -> 2주로 늘어난다.
    fetchAllQuotes.mockImplementation(async () => {
      writeFileSync(
        join(dataDir, "transactions.json"),
        JSON.stringify([baseTx, { ...baseTx, id: "tx-2", shares: 1 }]),
      );
      return {
        quotes: [{ symbolId: "QLD", price: 110, currency: "USD", asOf: "2024-01-02T00:00:00Z" }],
        missing: [],
        errors: [],
      };
    });

    const { GET } = await import("../route");
    const response = await GET(new Request("http://localhost/api/cron/refresh"));
    const body = await response.json();

    expect(body.ok).toBe(true);
    const snapshots = JSON.parse(readFileSync(join(dataDir, "snapshots.json"), "utf8"));
    // 캐시된(=조회 시작 시점) 1주가 아니라, 잠금 시점에 다시 읽은 2주 기준으로 계산돼야 한다.
    expect(snapshots[0].totalKrw).toBeCloseTo(2 * 110 * 1300);
    expect(body.totalKrw).toBeCloseTo(2 * 110 * 1300);
  });

  it("시세를 한 건도 못 받으면 저장하지 않고 502를 낸다", async () => {
    writeFixtures();
    fetchAllQuotes.mockResolvedValue({ quotes: [], missing: ["QLD"], errors: [] });

    const { GET } = await import("../route");
    const response = await GET(new Request("http://localhost/api/cron/refresh"));
    expect(response.status).toBe(502);

    const snapshots = JSON.parse(readFileSync(join(root, "data", "snapshots.json"), "utf8"));
    expect(snapshots).toEqual([]);
  });

  it("CRON_SECRET이 설정되면 잘못된/누락된 Authorization은 401로 거부한다", async () => {
    writeFixtures();
    vi.stubEnv("CRON_SECRET", "top-secret");
    fetchAllQuotes.mockResolvedValue({
      quotes: [{ symbolId: "QLD", price: 110, currency: "USD", asOf: "2024-01-02T00:00:00Z" }],
      missing: [],
      errors: [],
    });

    const { GET } = await import("../route");
    const unauthorized = await GET(new Request("http://localhost/api/cron/refresh"));
    expect(unauthorized.status).toBe(401);

    const authorized = await GET(
      new Request("http://localhost/api/cron/refresh", { headers: { authorization: "Bearer top-secret" } }),
    );
    expect(authorized.status).toBe(200);
  });
});
