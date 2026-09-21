import { describe, expect, it } from "vitest";
import { classifyInboxCsv, INBOX_KIND_LABEL } from "../inbox-classify.mjs";

/** 실제 증권사 내보내기처럼 Version 줄과 2단 헤더가 붙은 모양. */
function accountHistoryCsv() {
  return [
    "Version=1.0,,,,,,,,,,,,,",
    "일자,예탁자산,유가증권  평가금,매수금,입금,출금,수수료 +세금,연체,손익,수익률(%),누적손익 (손익합계),배당금액,환율,국가",
    ",,,매도금,입고,출고,,,,,,,,",
    '2026-09-15,"218,636,278","218,547,138",0,"1,959,820",0,0,0,"-520,483",-0.24,"-22,443,943","19,117",,',
  ].join("\n");
}

function positionBasisCsv() {
  return ["종목명,보유수량,매입단가,평가손익,수익률", "엔비디아,115,185.19,4078174,14.03"].join("\n");
}

describe("classifyInboxCsv", () => {
  it("계좌수익률 CSV를 알아본다", () => {
    expect(classifyInboxCsv(accountHistoryCsv())).toBe("account-history");
  });

  it("보유종목 CSV를 알아본다", () => {
    expect(classifyInboxCsv(positionBasisCsv())).toBe("position-basis");
  });

  it("네 열 중 하나라도 없으면 계좌수익률로 보지 않는다", () => {
    // 출금 열이 빠진 경우 — importer가 어차피 거부하므로 여기서 먼저 걸러야 한다.
    const csv = "일자,예탁자산,입금\n2026-09-15,100,0";
    expect(classifyInboxCsv(csv)).toBe("unknown");
  });

  it("관계없는 CSV는 unknown이다", () => {
    // 실제로 받았던 권리내역 파일의 헤더 모양.
    const csv = "Version=1.0\n권리구분,거래소코드,종목코드,기준일,보유수량\n";
    expect(classifyInboxCsv(csv)).toBe("unknown");
  });

  it("빈 값·비문자열은 unknown이다", () => {
    expect(classifyInboxCsv("")).toBe("unknown");
    expect(classifyInboxCsv("   ")).toBe("unknown");
    expect(classifyInboxCsv(undefined)).toBe("unknown");
  });

  it("헤더가 파일 앞쪽 어디에 있어도 찾는다", () => {
    const csv = ["안내문", "", "빈 줄", "일자,예탁자산,입금,출금", "2026-09-15,1,0,0"].join("\n");
    expect(classifyInboxCsv(csv)).toBe("account-history");
  });
});

describe("헤더 이름에 줄바꿈이 든 CSV", () => {
  // 판별기가 줄 단위로만 보던 시절엔 이런 파일이 "판별 못 함"으로 빠졌다 —
  // 일자·예탁자산과 입금·출금이 서로 다른 줄로 쪼개졌기 때문이다(2026-09-21).
  it("계좌수익률로 알아본다", () => {
    const csv = [
      "Version=1.0,,,,,,,,,,,,,",
      '일자,예탁자산,"유가증권',
      ' 평가금",매수금,입금,출금,"수수료',
      ' +세금",손익',
      "2026-09-18,1000,900,0,0,0,0,0",
    ].join("\n");

    expect(classifyInboxCsv(csv)).toBe("account-history");
  });
});

describe("거래내역(2110) CSV", () => {
  // 한 거래가 세 줄이고 헤더도 세 줄이다. 둘째 줄에 "종목명"이 있어 보유종목과
  // 헷갈리기 쉬운데, 보유종목에만 있는 "평가손익"이 없다는 점으로 갈린다.
  const csv = [
    "Version=1.0,,,,,,,,,,",
    "거래일자,거래종류,통화,거래수량,거래금액,정산금액,세금합,인지세,미수(원/주),변제합,매체구분",
    "종목코드,적요명,거래단가/환율,,예수금잔고,외화예수금잔고,,유가금잔,,연체합,처리시간",
    "거래소,종목명,,,거래금액(외),정산금액(외),수수료(외),미수(외),,변제합(외),외국납부세액",
    "2026-09-15,매매,USD,1,0,0,0,0,0,0,영웅문S",
    "QLD,매수,100,,0,0,,0,,0,9:30:00",
    "미국,QQQ2배,,,100,100.1,0.1,0,,0,0",
  ].join("\n");

  it("거래내역으로 알아본다", () => {
    expect(classifyInboxCsv(csv)).toBe("transactions");
  });

  it("사람이 읽을 이름이 있다", () => {
    expect(INBOX_KIND_LABEL.transactions).toBe("거래내역");
  });
});
