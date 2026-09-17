import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// refresh-job의 상태 파일 위치(homedir() 기준)를 테스트마다 새 임시 폴더로 돌린다.
let homeDir = "";
vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return { ...actual, homedir: () => homeDir || actual.tmpdir() };
});

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "refresh-job-"));
  homeDir = root;
  vi.resetModules();
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const statePath = () => join(root, "cgportfolio-logs", "refresh-job.json");

describe("readJob — 서버 재시작 복구 (GPT 3차 검수 12-4)", () => {
  it("running 상태로 저장된 채 모듈 메모리가 초기화되면(=서버 재시작) failed로 답한다", async () => {
    const mod1 = await import("../refresh-job");
    const job = mod1.beginJob();
    expect(job?.status).toBe("running");

    // vi.resetModules()로 새 프로세스를 흉내 낸다 — currentJob이 담긴 모듈 스코프
    // 변수가 사라지고, 다음 import는 상태 파일만 보고 새로 시작한다.
    vi.resetModules();
    const mod2 = await import("../refresh-job");
    const result = mod2.readJob(job!.jobId);

    expect(result?.status).toBe("failed");
    expect(result?.failure?.code).toBe("unknown");
    expect(result?.failure?.message).toContain("다시 시작");
  });

  it("완료된 작업은 재시작 후에도 그대로(done) 조회된다", async () => {
    const mod1 = await import("../refresh-job");
    const job = mod1.beginJob();
    mod1.finishJob(job!.jobId, { updated: 5, missingCount: 0, errorCount: 0 });

    vi.resetModules();
    const mod2 = await import("../refresh-job");
    const result = mod2.readJob(job!.jobId);

    expect(result?.status).toBe("done");
    expect(result?.updated).toBe(5);
  });

  it("실패로 끝난 작업도 재시작 후 실패 사유가 그대로 남는다", async () => {
    const mod1 = await import("../refresh-job");
    const job = mod1.beginJob();
    mod1.failJob(job!.jobId, { code: "provider", provider: "twelve-data", message: "한도 초과" });

    vi.resetModules();
    const mod2 = await import("../refresh-job");
    const result = mod2.readJob(job!.jobId);

    expect(result?.status).toBe("failed");
    expect(result?.failure?.code).toBe("provider");
  });

  it("상태 파일이 손상되면 '모르는 jobId'와 구분해 corrupted로 진단한다", async () => {
    const mod1 = await import("../refresh-job");
    const job = mod1.beginJob(); // 디렉터리를 만들어 둔다
    writeFileSync(statePath(), "{ 이건 유효한 JSON이 아니다", "utf8");

    vi.resetModules();
    const mod2 = await import("../refresh-job");

    expect(mod2.readJob(job!.jobId)).toBeNull();
    expect(mod2.diagnoseMissingJob()).toBe("corrupted");
  });

  it("상태 파일이 아예 없으면 not-found로 진단한다(손상과 구분)", async () => {
    const mod = await import("../refresh-job");
    expect(mod.readJob("존재한적없는-job")).toBeNull();
    expect(mod.diagnoseMissingJob()).toBe("not-found");
  });

  it("다른 jobId를 물으면 상태 파일이 멀쩡해도 not-found다", async () => {
    const mod1 = await import("../refresh-job");
    mod1.beginJob();

    vi.resetModules();
    const mod2 = await import("../refresh-job");

    expect(mod2.readJob("전혀-다른-job")).toBeNull();
    expect(mod2.diagnoseMissingJob()).toBe("not-found");
  });

  it("상태 파일을 원자적으로 쓴다 — 쓰다 만 상태가 남지 않는다", async () => {
    const mod = await import("../refresh-job");
    mod.beginJob();
    // 임시 파일이 남아 있지 않아야 한다(atomic-write가 정상 완료 후 정리한다).
    mkdirSync(join(root, "cgportfolio-logs"), { recursive: true });
    const fs = await import("node:fs");
    const entries = fs.readdirSync(join(root, "cgportfolio-logs"));
    expect(entries.filter((name) => name.includes(".tmp-"))).toEqual([]);
    expect(entries).toContain("refresh-job.json");
  });
});
