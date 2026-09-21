import { describe, expect, it } from "vitest";

import { parsePositionBasisCsv } from "../import-position-basis.mjs";

const header = "종목명,코드,보유량,매입가,매입금액,평가금액,평가손익,수수료";

describe("parsePositionBasisCsv", () => {
  it("보유량이 있는 행을 basis와 crossCheckInput 양쪽으로 만든다", () => {
    const csv = `${header}\n테스트,QLD,10,1000,10000,12000,1998,2`;
    const { basis, crossCheckInput } = parsePositionBasisCsv(csv, { accountId: "acc-1", at: "2026-01-01T00:00:00Z" });

    expect(basis).toEqual([
      {
        at: "2026-01-01T00:00:00Z",
        accountId: "acc-1",
        symbolId: "QLD",
        shares: 10,
        averagePrice: 1000,
        costBasis: 10000,
        estimatedExitFeeRate: 2 / 12000,
      },
    ]);
    expect(crossCheckInput).toEqual([{ symbolId: "QLD", value: 12000, costBasis: 10000, fee: 2, reportedGainLoss: 1998 }]);
  });

  it("코드 앞의 작은따옴표를 제거한다(엑셀이 숫자로 안 바꾸게 붙이는 접두사)", () => {
    const csv = `${header}\n테스트,'005930,10,1000,10000,12000,1998,2`;
    const { basis } = parsePositionBasisCsv(csv, { accountId: "acc-1", at: "2026-01-01T00:00:00Z" });
    expect(basis[0].symbolId).toBe("005930");
  });

  it("보유량이 0 이하인 행은 제외한다", () => {
    const csv = `${header}\n청산됨,SOLD,0,1000,0,0,0,0\n보유중,QLD,10,1000,10000,12000,1998,2`;
    const { basis } = parsePositionBasisCsv(csv, { accountId: "acc-1", at: "2026-01-01T00:00:00Z" });
    expect(basis).toHaveLength(1);
    expect(basis[0].symbolId).toBe("QLD");
  });

  it("헤더를 못 찾으면 에러를 던진다", () => {
    expect(() => parsePositionBasisCsv("a,b,c\n1,2,3", { accountId: "acc-1", at: "2026-01-01T00:00:00Z" })).toThrow(
      "헤더를 찾지 못했습니다",
    );
  });

  it("가져올 종목이 없으면 에러를 던진다", () => {
    const csv = `${header}\n청산됨,SOLD,0,1000,0,0,0,0`;
    expect(() => parsePositionBasisCsv(csv, { accountId: "acc-1", at: "2026-01-01T00:00:00Z" })).toThrow(
      "가져올 보유종목이 없습니다",
    );
  });
});

describe("소수점 보유가 별도 행으로 오는 경우", () => {
  // 키움 잔고 CSV는 같은 종목이라도 온주와 소수점을 나눠 내보낸다(`소수점구분` 열).
  // 합치지 않으면 계좌×종목이 중복돼 검증에서 막힌다(2026-09-21 실제로 겪음).
  const csv = [
    "Version=1.0",
    "코드,종목명,평가손익,매입가,보유량,현재가,매입금액,평가금액,수수료,소수점구분",
    "SOXL,디렉시온,1000,150,3,200,450,600,1,온주",
    "SOXL,디렉시온,2000,125,7,200,875,1400,2,소수점",
  ].join("\n");

  it("한 줄로 합치고 평단을 다시 구한다", () => {
    const { basis } = parsePositionBasisCsv(csv, { accountId: "acc", at: "2026-09-21T00:00:00Z" });

    expect(basis).toHaveLength(1);
    expect(basis[0].shares).toBe(10);
    expect(basis[0].costBasis).toBe(1325);
    expect(basis[0].averagePrice).toBe(132.5); // 어느 한쪽 평단(150·125)이 아니라 가중평균
  });

  it("교차검증 입력도 합산한 값으로 낸다", () => {
    const { crossCheckInput } = parsePositionBasisCsv(csv, { accountId: "acc", at: "2026-09-21T00:00:00Z" });

    expect(crossCheckInput).toHaveLength(1);
    expect(crossCheckInput[0].value).toBe(2000);
    expect(crossCheckInput[0].fee).toBe(3);
    expect(crossCheckInput[0].reportedGainLoss).toBe(3000);
  });
});
