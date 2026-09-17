import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

let homeDir = "";
vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return { ...actual, homedir: () => homeDir || actual.tmpdir() };
});

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "refresh-status-route-"));
  homeDir = root;
  vi.resetModules();
  vi.unstubAllEnvs();
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

describe("GET /api/cron/refresh/status — 인증", () => {
  it("CRON_SECRET이 없으면 인증 없이도 통과한다", async () => {
    vi.stubEnv("CRON_SECRET", "");
    const { GET } = await import("../route");
    const response = await GET(new Request("http://localhost/api/cron/refresh/status"));
    expect(response.status).toBe(200);
  });

  it("CRON_SECRET이 설정되면 잘못된/누락된 Authorization은 401이다", async () => {
    vi.stubEnv("CRON_SECRET", "top-secret");
    const { GET } = await import("../route");

    const missing = await GET(new Request("http://localhost/api/cron/refresh/status"));
    expect(missing.status).toBe(401);

    const wrong = await GET(
      new Request("http://localhost/api/cron/refresh/status", { headers: { authorization: "Bearer nope" } }),
    );
    expect(wrong.status).toBe(401);
  });

  it("올바른 Authorization은 200이다", async () => {
    vi.stubEnv("CRON_SECRET", "top-secret");
    const { GET } = await import("../route");
    const response = await GET(
      new Request("http://localhost/api/cron/refresh/status", { headers: { authorization: "Bearer top-secret" } }),
    );
    expect(response.status).toBe(200);
  });
});

describe("GET /api/cron/refresh/status — 조회 결과", () => {
  it("jobId 없이 부르면 지금 도는 작업 유무만 알려준다", async () => {
    const { GET } = await import("../route");
    const response = await GET(new Request("http://localhost/api/cron/refresh/status"));
    const body = await response.json();
    expect(body).toEqual({ ok: true, running: null });
  });

  it("모르는 jobId는 404 unknown-job이다", async () => {
    const { GET } = await import("../route");
    const response = await GET(new Request("http://localhost/api/cron/refresh/status?jobId=없는값"));
    expect(response.status).toBe(404);
    expect((await response.json()).code).toBe("unknown-job");
  });

  it("갱신 도중 서버가 재시작되면(모듈 메모리 소실) 이 라우트가 failed로 답한다", async () => {
    // 1) 첫 "프로세스"에서 작업을 시작한다 — running 상태가 파일에 남는다.
    const jobModule1 = await import("@/lib/data/refresh-job");
    const job = jobModule1.beginJob();
    expect(job?.status).toBe("running");

    // 2) 서버 재시작을 흉내 — 모듈 메모리(currentJob)가 사라진다.
    vi.resetModules();

    // 3) 새 "프로세스"에서 같은 jobId를 라우트로 조회하면 failed여야 한다.
    const { GET } = await import("../route");
    const response = await GET(new Request(`http://localhost/api/cron/refresh/status?jobId=${job!.jobId}`));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.job.status).toBe("failed");
    expect(body.job.failure.message).toContain("다시 시작");
  });

  it("상태 파일이 손상되면 500 corrupted-state로 답하고 unknown-job과 구분한다", async () => {
    const jobModule1 = await import("@/lib/data/refresh-job");
    const job = jobModule1.beginJob();
    writeFileSync(join(root, "cgportfolio-logs", "refresh-job.json"), "{ 깨진 JSON", "utf8");

    vi.resetModules();
    const { GET } = await import("../route");
    const response = await GET(new Request(`http://localhost/api/cron/refresh/status?jobId=${job!.jobId}`));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.code).toBe("corrupted-state");
  });
});
