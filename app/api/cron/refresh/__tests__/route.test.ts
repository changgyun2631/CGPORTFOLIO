import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// refresh-job이 상태 파일을 쓰는 곳을 임시 폴더로 돌린다.
let homeDir = "";
vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return { ...actual, homedir: () => homeDir || actual.tmpdir() };
});

// 실제 로그 폴더(~/cgportfolio-logs/)를 건드리지 않는다.
vi.mock("@/lib/data/cron-log", () => ({ logCronStage: vi.fn() }));

// 실제 API를 부르지 않는다. fetchAllQuotes는 "외부 조회 중 다른 프로세스가 data/를
// 바꾼" 상황을 흉내내는 부수효과를 가진 채로 각 테스트에서 다시 정의한다.
const fetchAllQuotes = vi.fn();
const buildFxProvider = vi.fn(
  (): { name: string; fetchRate: () => Promise<{ rate: number; prevRate: number; asOf: string }> } | null => null,
);
vi.mock("@/lib/providers", () => ({
  fetchAllQuotes: (symbols: unknown) => fetchAllQuotes(symbols),
  buildFxProvider: () => buildFxProvider(),
}));

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "cron-route-"));
  homeDir = root;
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
  writeFileSync(
    join(dataDir, "quotes.json"),
    JSON.stringify([
      { symbolId: "QLD", price: 100, currency: "USD", asOf: "2024-01-01T00:00:00Z" },
      // NVDA는 보유 종목이 아니어도 항상 조회된다(symbols.json 전체를 매번 조회) —
      // 휴장 판단의 기준 종목으로 쓴다.
      { symbolId: "NVDA", price: 200, currency: "USD", asOf: "2024-01-01T00:00:00Z" },
    ]),
  );
  writeFileSync(
    join(dataDir, "fx-quote.json"),
    JSON.stringify({ pair: "USD/KRW", rate: 1300, prevRate: 1290, asOf: "2024-01-01T00:00:00Z" }),
  );
  writeFileSync(join(dataDir, "snapshots.json"), JSON.stringify([]));
  writeFileSync(join(dataDir, "lookthrough.json"), JSON.stringify({}));
  writeFileSync(join(dataDir, "fx.json"), JSON.stringify([{ d: "2024-01-01", rate: 1300 }]));

  return { dataDir, baseTx };
}

/** 접수 뒤 작업이 끝날 때까지 기다린다. 라우트가 202로 먼저 돌아오기 때문이다. */
async function waitForJob(readJob: (id: string) => unknown, jobId: string) {
  for (let i = 0; i < 200; i += 1) {
    const job = readJob(jobId) as { status?: string } | null;
    if (job && job.status !== "running") return job;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("작업이 끝나지 않았습니다");
}

describe("GET /api/cron/refresh", () => {
  it("접수 즉시 jobId를 돌려주고, 작업이 끝나면 새 스냅샷이 쌓인다", async () => {
    writeFixtures();
    fetchAllQuotes.mockResolvedValue({
      quotes: [{ symbolId: "QLD", price: 110, currency: "USD", asOf: "2024-01-02T00:00:00Z" }],
      missing: [],
      errors: [],
    });

    const { GET } = await import("../route");
    const { readJob } = await import("@/lib/data/refresh-job");

    const response = await GET(new Request("http://localhost/api/cron/refresh"));
    const body = await response.json();
    // 긴 응답을 붙잡지 않는다 — 이게 headersTimeout 오판을 없앤 핵심이다.
    expect(response.status).toBe(202);
    expect(body.jobId).toBeTruthy();

    const job = (await waitForJob(readJob, body.jobId)) as { status: string; updated: number };
    expect(job.status).toBe("done");
    expect(job.updated).toBe(1);

    const snapshots = JSON.parse(readFileSync(join(root, "data", "snapshots.json"), "utf8"));
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].totalKrw).toBeCloseTo(1 * 110 * 1300); // 1주 * 새 시세 110 * 환율 1300
  });

  it("WORK_ORDER B-0A-3: 외부 시세 조회 중 다른 프로세스가 잔고를 바꾸면, 잠금 안에서 다시 읽은 최신 값으로 계산한다", async () => {
    const { dataDir, baseTx } = writeFixtures();

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
    const { readJob } = await import("@/lib/data/refresh-job");
    const { jobId } = await (await GET(new Request("http://localhost/api/cron/refresh"))).json();
    await waitForJob(readJob, jobId);

    const snapshots = JSON.parse(readFileSync(join(dataDir, "snapshots.json"), "utf8"));
    // 캐시된(=조회 시작 시점) 1주가 아니라, 잠금 시점에 다시 읽은 2주 기준으로 계산돼야 한다.
    expect(snapshots[0].totalKrw).toBeCloseTo(2 * 110 * 1300);
  });

  it("시세를 한 건도 못 받으면 저장하지 않고 provider 실패로 끝난다", async () => {
    writeFixtures();
    fetchAllQuotes.mockResolvedValue({ quotes: [], missing: ["QLD"], errors: [{ provider: "twelve-data", message: "한도 초과" }] });

    const { GET } = await import("../route");
    const { readJob } = await import("@/lib/data/refresh-job");
    const { jobId } = await (await GET(new Request("http://localhost/api/cron/refresh"))).json();

    const job = (await waitForJob(readJob, jobId)) as { status: string; failure: { code: string; provider: string } };
    expect(job.status).toBe("failed");
    expect(job.failure.code).toBe("provider");
    expect(job.failure.provider).toBe("twelve-data");

    const snapshots = JSON.parse(readFileSync(join(root, "data", "snapshots.json"), "utf8"));
    expect(snapshots).toEqual([]);
  });

  it("이미 갱신이 돌고 있으면 두 번째 호출은 409로 막고 중복 쓰기를 시작하지 않는다", async () => {
    writeFixtures();
    let release: () => void = () => {};
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    let calls = 0;
    fetchAllQuotes.mockImplementation(async () => {
      calls += 1;
      await blocked;
      return {
        quotes: [{ symbolId: "QLD", price: 110, currency: "USD", asOf: "2024-01-02T00:00:00Z" }],
        missing: [],
        errors: [],
      };
    });

    const { GET } = await import("../route");
    const { readJob } = await import("@/lib/data/refresh-job");

    const first = await (await GET(new Request("http://localhost/api/cron/refresh"))).json();
    // 첫 작업이 외부 조회에 실제로 들어갈 때까지 기다린 뒤 두 번째를 친다.
    while (calls === 0) await new Promise((resolve) => setTimeout(resolve, 10));

    const second = await GET(new Request("http://localhost/api/cron/refresh"));
    const secondBody = await second.json();

    expect(second.status).toBe(409);
    expect(secondBody.code).toBe("duplicate");
    expect(secondBody.jobId).toBe(first.jobId);
    expect(calls).toBe(1); // 외부 조회가 두 벌 돌지 않는다

    release();
    await waitForJob(readJob, first.jobId);
    const snapshots = JSON.parse(readFileSync(join(root, "data", "snapshots.json"), "utf8"));
    expect(snapshots).toHaveLength(1); // 한 점만 쌓인다
  });

  it("기준 종목(NVDA) 시세가 직전과 완전히 같으면 새 점을 찍지 않는다(휴장 추정)", async () => {
    writeFixtures();
    const quotes = [
      { symbolId: "QLD", price: 110, currency: "USD", asOf: "2024-01-02T00:00:00Z" },
      { symbolId: "NVDA", price: 200, currency: "USD", asOf: "2024-01-02T00:00:00Z" },
    ];
    fetchAllQuotes.mockResolvedValue({ quotes, missing: [], errors: [] });

    const { GET } = await import("../route");
    const { readJob } = await import("@/lib/data/refresh-job");
    const { logCronStage } = await import("@/lib/data/cron-log");

    const first = await (await GET(new Request("http://localhost/api/cron/refresh"))).json();
    await waitForJob(readJob, first.jobId);
    const afterFirst = JSON.parse(readFileSync(join(root, "data", "snapshots.json"), "utf8"));
    expect(afterFirst).toHaveLength(1);

    // 같은 시세로 다시 갱신 — 주말 6시간 주기 cron이 전날과 똑같은 값을
    // 다시 받아오는 상황을 흉내낸다.
    const second = await (await GET(new Request("http://localhost/api/cron/refresh"))).json();
    await waitForJob(readJob, second.jobId);
    const afterSecond = JSON.parse(readFileSync(join(root, "data", "snapshots.json"), "utf8"));

    expect(afterSecond).toHaveLength(1); // NVDA 시세가 안 바뀌었으니 점을 더 찍지 않는다
    expect(afterSecond[0]).toEqual(afterFirst[0]);
    expect(logCronStage).toHaveBeenCalledWith(expect.stringContaining("스냅샷 건너뜀"));
  });

  it("기준 종목(NVDA) 시세가 아주 조금이라도 바뀌면 프리·애프터마켓이어도 새 점을 찍는다", async () => {
    writeFixtures();
    // marketState(장 상태) 플래그를 기준으로 삼았을 때는 평일 프리·애프터마켓까지
    // "open 아님"으로 묶여서 건너뛰었다 — 프리·애프터마켓엔 실거래로 가격이
    // 움직이니 그건 기록해야 한다는 지적(2026-09-21)에 따라 시세 변동 자체로
    // 판단하도록 바꿨다. 정규장 여부와 무관하게 기준 종목 시세가 움직이면 기록된다.
    fetchAllQuotes
      .mockResolvedValueOnce({
        quotes: [
          { symbolId: "QLD", price: 110, currency: "USD", asOf: "2024-01-02T00:00:00Z" },
          { symbolId: "NVDA", price: 200, currency: "USD", asOf: "2024-01-02T00:00:00Z" },
        ],
        missing: [],
        errors: [],
      })
      .mockResolvedValueOnce({
        quotes: [
          { symbolId: "QLD", price: 110, currency: "USD", asOf: "2024-01-02T06:00:00Z" },
          { symbolId: "NVDA", price: 200.01, currency: "USD", asOf: "2024-01-02T06:00:00Z" },
        ],
        missing: [],
        errors: [],
      });

    const { GET } = await import("../route");
    const { readJob } = await import("@/lib/data/refresh-job");

    const first = await (await GET(new Request("http://localhost/api/cron/refresh"))).json();
    await waitForJob(readJob, first.jobId);
    const afterFirst = JSON.parse(readFileSync(join(root, "data", "snapshots.json"), "utf8"));
    expect(afterFirst).toHaveLength(1);

    const second = await (await GET(new Request("http://localhost/api/cron/refresh"))).json();
    await waitForJob(readJob, second.jobId);
    const afterSecond = JSON.parse(readFileSync(join(root, "data", "snapshots.json"), "utf8"));

    expect(afterSecond).toHaveLength(2); // NVDA가 조금이라도 움직였으니 새 점을 찍는다
  });

  it("기준 종목 시세는 그대로인데 환율만 바뀌어도(주말 FX 변동) 새 점을 찍지 않는다", async () => {
    writeFixtures();
    const quotes = [
      { symbolId: "QLD", price: 110, currency: "USD", asOf: "2024-01-02T00:00:00Z" },
      { symbolId: "NVDA", price: 200, currency: "USD", asOf: "2024-01-02T00:00:00Z" },
    ];
    fetchAllQuotes.mockResolvedValue({ quotes, missing: [], errors: [] });

    let rate = 1300;
    buildFxProvider.mockReturnValue({
      name: "test-fx",
      fetchRate: async () => ({ rate, prevRate: 1290, asOf: "2024-01-02T00:00:00Z" }),
    });

    const { GET } = await import("../route");
    const { readJob } = await import("@/lib/data/refresh-job");

    const first = await (await GET(new Request("http://localhost/api/cron/refresh"))).json();
    await waitForJob(readJob, first.jobId);
    const afterFirst = JSON.parse(readFileSync(join(root, "data", "snapshots.json"), "utf8"));
    expect(afterFirst).toHaveLength(1);

    // 환율만 바뀐다 — 기준 종목(NVDA) 시세 자체는 그대로다. 총액·환율로 비교하면
    // 이 경우 "바뀌었다"고 오판해 점을 또 찍었을 것이다(2026-09-21 사용자 지적).
    rate = 1320;
    const second = await (await GET(new Request("http://localhost/api/cron/refresh"))).json();
    await waitForJob(readJob, second.jobId);
    const afterSecond = JSON.parse(readFileSync(join(root, "data", "snapshots.json"), "utf8"));

    expect(afterSecond).toHaveLength(1);
    expect(afterSecond[0]).toEqual(afterFirst[0]);

    const fxQuote = JSON.parse(readFileSync(join(root, "data", "fx-quote.json"), "utf8"));
    expect(fxQuote.rate).toBe(1320); // fx-quote.json 자체는 최신으로 갱신된다(신선도 유지)
  });

  it("기준 종목 시세를 아예 조회한 적 없으면, 안전하게 계속 점을 찍는다", async () => {
    // symbols.json에 NVDA가 없는 배포(또는 아직 한 번도 못 받은 상태)를
    // 흉내낸다 — 판단할 근거가 없을 땐 "휴장으로 단정"하지 않고 매번 기록해서
    // 조용히 데이터가 끊기는 걸 막는다.
    const { dataDir } = writeFixtures();
    writeFileSync(
      join(dataDir, "quotes.json"),
      JSON.stringify([{ symbolId: "QLD", price: 100, currency: "USD", asOf: "2024-01-01T00:00:00Z" }]),
    );
    fetchAllQuotes.mockResolvedValue({
      quotes: [{ symbolId: "QLD", price: 110, currency: "USD", asOf: "2024-01-02T00:00:00Z" }],
      missing: [],
      errors: [],
    });

    const { GET } = await import("../route");
    const { readJob } = await import("@/lib/data/refresh-job");

    const first = await (await GET(new Request("http://localhost/api/cron/refresh"))).json();
    await waitForJob(readJob, first.jobId);
    const second = await (await GET(new Request("http://localhost/api/cron/refresh"))).json();
    await waitForJob(readJob, second.jobId);

    const snapshots = JSON.parse(readFileSync(join(root, "data", "snapshots.json"), "utf8"));
    expect(snapshots).toHaveLength(2);
  });

  it("모르는 jobId를 물으면 404로 답한다", async () => {
    writeFixtures();
    const { GET } = await import("../status/route");
    const response = await GET(new Request("http://localhost/api/cron/refresh/status?jobId=없는값"));
    expect(response.status).toBe(404);
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
    expect(authorized.status).toBe(202);

    const { readJob } = await import("@/lib/data/refresh-job");
    await waitForJob(readJob, (await authorized.json()).jobId);
  });
});
