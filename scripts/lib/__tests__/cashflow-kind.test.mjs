import { describe, expect, it } from "vitest";

import { classifyCashFlowKind } from "../cashflow-kind.mjs";

describe("classifyCashFlowKind", () => {
  it("실제 입출금만 원금(external)으로 본다", () => {
    expect(classifyCashFlowKind("이체입금(지급결제)")).toBe("external");
    expect(classifyCashFlowKind("이체오픈뱅킹입금")).toBe("external");
    expect(classifyCashFlowKind("대체출금")).toBe("external");
    expect(classifyCashFlowKind("공모주환불금입금")).toBe("external");
  });

  it("환전은 원금이 아니다 — 돈이 들어온 게 아니라 통화만 바뀐 것이다", () => {
    expect(classifyCashFlowKind("환전정산입금")).toBe("exchange");
    expect(classifyCashFlowKind("환전(외화매수), 환율 1400.00")).toBe("exchange");
  });

  it("계좌가 스스로 만든 돈은 수익으로 본다", () => {
    // 이 적요명들이 예전 원장에서 통째로 빠져 있었고, 예수금이 안 맞자
    // "원인 미상"인 보정값을 손으로 넣어야 했다(HANDOFF 15절).
    expect(classifyCashFlowKind("예탁금이용료(이자)입금")).toBe("income");
    expect(classifyCashFlowKind("대여수수료입금(정기)")).toBe("income");
    expect(classifyCashFlowKind("외국납부세환급(외화)입금")).toBe("income");
    expect(classifyCashFlowKind("주식더모으기쿠폰입금")).toBe("income");
    expect(classifyCashFlowKind("세액추징(배당)출금")).toBe("income");
  });

  it("사람이 맞춘 보정값은 원금에도 수익에도 넣지 않는다", () => {
    expect(classifyCashFlowKind("원장 재구성 보정 - 실제 예수금에 맞춘 값")).toBe("adjustment");
  });

  it("적요명이 없으면 외부 입출금으로 본다", () => {
    expect(classifyCashFlowKind(undefined)).toBe("external");
  });
});
