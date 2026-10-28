"use client";

import { createContext, useContext, useState, type ReactNode } from "react";

import { Treemap, type TreemapDatum } from "@/components/charts/treemap";

/**
 * 자산맵 탭의 금액 표시 켜기/끄기. 외부에 공유할 이미지에는 금액을 넣을 수 없어서,
 * 끈 상태에서 "이미지 복사"를 누르면 금액 없는 이미지가 나온다. 대시보드는 항상 금액을 보여준다.
 */

const AmountsContext = createContext(true);
const ToggleContext = createContext<() => void>(() => {});
const StateContext = createContext(true);

export function AmountsProvider({ children, className }: { children: ReactNode; className?: string }) {
  const [show, setShow] = useState(true);
  return (
    <StateContext.Provider value={show}>
      <ToggleContext.Provider value={() => setShow((value) => !value)}>
        <AmountsContext.Provider value={show}>
          <div className={className}>{children}</div>
        </AmountsContext.Provider>
      </ToggleContext.Provider>
    </StateContext.Provider>
  );
}

/** 금액을 감싼다. 끄면 아무것도 그리지 않는다(표의 열 전체를 감싸 열째 없앨 수도 있다). */
export function Amount({ children }: { children: ReactNode }) {
  return useContext(AmountsContext) ? <>{children}</> : null;
}

export function AmountsToggle() {
  const show = useContext(StateContext);
  const toggle = useContext(ToggleContext);
  return (
    <button
      type="button"
      role="switch"
      aria-checked={show}
      onClick={toggle}
      className="inline-flex items-center gap-2 rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:border-line-strong hover:text-text"
    >
      <span className={`relative h-4 w-7 rounded-full transition-colors ${show ? "bg-accent" : "bg-line-strong"}`}>
        <span className={`absolute top-0.5 size-3 rounded-full bg-white transition-all ${show ? "left-3.5" : "left-0.5"}`} />
      </span>
      금액 표시 {show ? "켬" : "끔"}
    </button>
  );
}

export function AssetMapTreemap({ data, height }: { data: TreemapDatum[]; height: number }) {
  return <Treemap data={data} height={height} showAmounts={useContext(AmountsContext)} />;
}
