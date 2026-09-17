import { describe, expect, it } from "vitest";
import { decodeBrokerCsv } from "../csv.mjs";
import { classifyInboxCsv } from "../inbox-classify.mjs";

/** 실제 증권사 CSV의 헤더 줄. 한글이 들어가야 인코딩 판별이 의미가 있다. */
const HEADER = "일자,예탁자산,입금,출금";

/**
 * `HEADER`를 EUC-KR로 인코딩한 바이트. Node에는 EUC-KR 인코더가 없어서
 * 실제 증권사 파일에서 뽑은 바이트를 그대로 적어 둔다 — 디코딩해 보면
 * 위 `HEADER`와 같은 문자열이 나온다.
 */
const HEADER_EUC_KR = Uint8Array.from([
  0xc0, 0xcf, 0xc0, 0xda, 0x2c, 0xbf, 0xb9, 0xc5, 0xb9, 0xc0, 0xda, 0xbb, 0xea, 0x2c, 0xc0, 0xd4, 0xb1, 0xdd, 0x2c,
  0xc3, 0xe2, 0xb1, 0xdd,
]);

describe("decodeBrokerCsv", () => {
  it("증권사가 바로 내려준 EUC-KR 파일을 읽는다", () => {
    expect(decodeBrokerCsv(HEADER_EUC_KR)).toBe(HEADER);
  });

  it("엑셀에서 다시 저장한 UTF-8(BOM 포함) 파일을 읽는다", () => {
    const bytes = Uint8Array.from([0xef, 0xbb, 0xbf, ...Buffer.from(HEADER, "utf8")]);
    expect(decodeBrokerCsv(bytes)).toBe(HEADER);
  });

  it("BOM 없는 UTF-8 파일도 읽는다", () => {
    expect(decodeBrokerCsv(Buffer.from(HEADER, "utf8"))).toBe(HEADER);
  });

  it("인코딩이 달라도 같은 종류로 판별된다", () => {
    // 이게 깨지면 UTF-8로 저장한 파일이 받은 폴더에서 조용히 실패 폴더로 밀린다.
    const utf8 = Uint8Array.from([0xef, 0xbb, 0xbf, ...Buffer.from(`${HEADER}\n2026-09-15,1,0,0`, "utf8")]);
    expect(classifyInboxCsv(decodeBrokerCsv(HEADER_EUC_KR))).toBe("account-history");
    expect(classifyInboxCsv(decodeBrokerCsv(utf8))).toBe("account-history");
  });
});
