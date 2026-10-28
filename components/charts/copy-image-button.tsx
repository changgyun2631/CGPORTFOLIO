"use client";

import { useState } from "react";

/**
 * 화면의 자산맵(`svg[data-treemap]`)을 PNG 이미지로 클립보드에 복사한다. 외부 글·메신저에 붙여넣는 용도.
 * 색은 CSS 변수라 따로 떨어진 SVG 이미지로는 풀리지 않아, 지금 계산된 색으로 바꿔서 그린다.
 * 클립보드 이미지 복사가 안 되는 환경(보안 연결이 아닌 주소 등)에서는 파일로 저장한다.
 */

const SCALE = 2;
const PAD = 24;
const CAPTION = "자산맵 · 면적은 평가금액 비중, 색은 전일 등락률";

function renderPng(svg: SVGSVGElement): Promise<Blob> {
  const { width, height } = svg.viewBox.baseVal;
  const clone = svg.cloneNode(true) as SVGSVGElement;
  const from = [svg, ...svg.querySelectorAll("*")];
  const to = [clone, ...clone.querySelectorAll("*")];
  from.forEach((el, i) => {
    const style = getComputedStyle(el);
    if (to[i].hasAttribute("fill")) to[i].setAttribute("fill", style.fill);
    if (to[i].hasAttribute("stroke")) to[i].setAttribute("stroke", style.stroke);
    if (to[i].tagName === "text") to[i].setAttribute("font-family", style.fontFamily);
  });
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("width", String(width));
  clone.setAttribute("height", String(height));

  const bodyStyle = getComputedStyle(document.body);
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = (width + PAD * 2) * SCALE;
      canvas.height = (height + PAD * 2 + 28) * SCALE;
      const ctx = canvas.getContext("2d");
      if (!ctx) return reject(new Error("캔버스를 만들지 못했습니다."));
      ctx.scale(SCALE, SCALE);
      ctx.fillStyle = bodyStyle.backgroundColor;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(image, PAD, PAD, width, height);
      ctx.fillStyle = bodyStyle.color;
      ctx.globalAlpha = 0.6;
      ctx.font = `12px ${bodyStyle.fontFamily}`;
      ctx.fillText(CAPTION, PAD, height + PAD + 20);
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("이미지를 만들지 못했습니다."))), "image/png");
    };
    image.onerror = () => reject(new Error("이미지를 그리지 못했습니다."));
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(clone))}`;
  });
}

export function CopyTreemapButton() {
  const [message, setMessage] = useState("");

  async function copy() {
    const svg = document.querySelector<SVGSVGElement>("svg[data-treemap]");
    if (!svg) return;
    setMessage("만드는 중…");
    try {
      const png = renderPng(svg);
      if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
        await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
        setMessage("복사됨 · 붙여넣기(Ctrl+V)로 쓰세요");
      } else {
        const link = document.createElement("a");
        link.href = URL.createObjectURL(await png);
        link.download = "asset-map.png";
        link.click();
        URL.revokeObjectURL(link.href);
        setMessage("이 환경에서는 복사가 안 돼 파일로 저장했습니다");
      }
    } catch (error) {
      setMessage(`실패: ${(error as Error).message}`);
    }
    setTimeout(() => setMessage(""), 4000);
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={copy}
        className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:border-line-strong hover:text-text"
      >
        이미지 복사
      </button>
      <span role="status" className="text-xs text-faint">
        {message}
      </span>
    </span>
  );
}
