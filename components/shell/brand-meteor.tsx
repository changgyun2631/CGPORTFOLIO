"use client";

import { useEffect, useRef } from "react";

import { BRAND_EMBLEM, BRAND_VIEWBOX } from "./brand-paths";

/**
 * 로고 원형 배지 위를 도는 별똥별. 가는 빛이 배지 바깥 테두리를 한 바퀴 돌며 옅은
 * 빛 자국과 반짝이 가루를 남기고, 한 바퀴를 다 돌면 햇빛이 스치듯 배지가 반짝인다.
 * 글자(PORTFOLIO)는 가리지 않는다.
 *
 * 테두리 좌표는 숨긴 SVG 경로의 getPointAtLength로 얻고, 그림은 로고보다 조금 큰
 * 캔버스 두 장에 그린다 — 빛 자국용(조금씩 지워 잔상이 남는다)과 반짝임용(매번 새로).
 */

/** 머리가 테두리를 따라가는 속도(로고 좌표 단위/초). 낮을수록 느리다. */
const SPEED = 300;
/** 한 바퀴 뒤 쉬는 시간(초). 이 동안 배지가 반짝인다. */
const REST_S = 1.6;
/** 반짝임이 배지를 가로지르는 시간(초) */
const SHINE_S = 0.9;
/** 매 프레임 지우는 비율 — 작을수록 빛 자국이 오래 남는다. */
const TRAIL_FADE = 0.07;
/** 프레임마다 가루를 뿌릴 확률 */
const SPARKS_PER_FRAME = 0.35;
/** 캔버스를 로고 밖으로 넓히는 여백(px). 가루가 테두리에서 잘리지 않게 한다. */
const BLEED = 10;

const [, , VIEW_W] = BRAND_VIEWBOX.split(" ").map(Number);

/** 배지의 가장 긴 윤곽선 = 바깥 테두리 */
const RIM = BRAND_EMBLEM.split(/(?=M)/)
  .filter(Boolean)
  .reduce((a, b) => (b.length > a.length ? b : a), "");

type Spark = { x: number; y: number; vx: number; vy: number; life: number; max: number; size: number };

export function BrandMeteor() {
  const trailRef = useRef<HTMLCanvasElement>(null);
  const shineRef = useRef<HTMLCanvasElement>(null);
  const rimRef = useRef<SVGPathElement>(null);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const trail = trailRef.current;
    const shine = shineRef.current;
    const rim = rimRef.current;
    const ctx = trail?.getContext("2d");
    const sctx = shine?.getContext("2d");
    if (!trail || !shine || !rim || !ctx || !sctx) return;

    const length = rim.getTotalLength();
    const box = rim.getBBox();
    const emblem = new Path2D(BRAND_EMBLEM);

    let scale = 1;
    let width = 0;
    let height = 0;
    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      ({ width, height } = trail.getBoundingClientRect());
      for (const [canvas, c] of [[trail, ctx], [shine, sctx]] as const) {
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);
        c.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
      scale = (width - BLEED * 2) / VIEW_W;
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(trail);

    const toCanvas = (p: DOMPoint) => ({ x: BLEED + p.x * scale, y: BLEED + p.y * scale });
    const sparks: Spark[] = [];
    let travelled = 0;
    let resting = 0;
    let prev: { x: number; y: number } | null = null;
    let last = performance.now();
    let frame = 0;

    const tick = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;

      // 빛 자국 캔버스: 이전 그림을 조금씩 지워 잔상이 서서히 사라지게 한다.
      ctx.globalCompositeOperation = "destination-out";
      ctx.fillStyle = `rgba(0, 0, 0, ${TRAIL_FADE})`;
      ctx.fillRect(0, 0, width, height);
      ctx.globalCompositeOperation = "lighter";

      let head: { x: number; y: number } | null = null;
      if (resting > 0) {
        resting = Math.max(resting - dt, 0);
      } else {
        travelled += SPEED * dt;
        if (travelled >= length) {
          travelled = 0;
          prev = null;
          resting = REST_S;
        } else {
          head = toCanvas(rim.getPointAtLength(travelled));
        }
      }

      if (head) {
        if (prev) {
          ctx.strokeStyle = "rgba(255, 255, 255, 0.75)";
          ctx.lineWidth = 1.8;
          ctx.lineCap = "round";
          ctx.shadowColor = "rgba(255, 255, 255, 0.9)";
          ctx.shadowBlur = 5;
          ctx.beginPath();
          ctx.moveTo(prev.x, prev.y);
          ctx.lineTo(head.x, head.y);
          ctx.stroke();
        }
        prev = head;
        if (Math.random() < SPARKS_PER_FRAME) {
          const max = 0.5 + Math.random() * 0.7;
          sparks.push({
            x: head.x,
            y: head.y,
            vx: (Math.random() - 0.5) * 12,
            vy: (Math.random() - 0.7) * 10,
            life: max,
            max,
            size: 0.4 + Math.random() * 0.8,
          });
        }
      }

      ctx.shadowBlur = 1.5;
      for (let i = sparks.length - 1; i >= 0; i--) {
        const s = sparks[i];
        s.life -= dt;
        if (s.life <= 0) {
          sparks.splice(i, 1);
          continue;
        }
        s.vy += 10 * dt;
        s.x += s.vx * dt;
        s.y += s.vy * dt;
        ctx.fillStyle = `rgba(255, 255, 255, ${((s.life / s.max) * (0.3 + Math.random() * 0.4)).toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.size, 0, Math.PI * 2);
        ctx.fill();
      }

      if (head) {
        ctx.shadowBlur = 7;
        ctx.fillStyle = "#fff";
        ctx.beginPath();
        ctx.arc(head.x, head.y, 2, 0, Math.PI * 2);
        ctx.fill();
      }

      // 반짝임: 한 바퀴를 마치면 사선 빛줄기가 배지 위를 왼쪽 위에서 오른쪽 아래로 스친다.
      sctx.clearRect(0, 0, width, height);
      const t = (REST_S - resting) / SHINE_S;
      if (resting > 0 && t < 1) {
        sctx.save();
        sctx.translate(BLEED, BLEED);
        sctx.scale(scale, scale);
        sctx.clip(emblem, "evenodd");
        const span = box.width + box.height;
        const center = box.x - box.height + t * span * 1.4;
        const band = box.width * 0.35;
        const gradient = sctx.createLinearGradient(center - band, box.y, center + band, box.y + box.height * 0.6);
        gradient.addColorStop(0, "rgba(255, 255, 255, 0)");
        gradient.addColorStop(0.5, `rgba(255, 255, 255, ${(0.75 * Math.sin(Math.PI * t)).toFixed(3)})`);
        gradient.addColorStop(1, "rgba(255, 255, 255, 0)");
        sctx.fillStyle = gradient;
        sctx.fillRect(box.x, box.y, box.width, box.height);
        sctx.restore();
      }

      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, []);

  return (
    <>
      {/* 좌표 계산용으로만 쓰는 숨김 경로. 로고 svg 크기 CSS(.brand-lockup svg)가 먹지 않게
          크기를 직접 0으로 두고 칠하지 않는다. */}
      <svg viewBox={BRAND_VIEWBOX} aria-hidden="true" fill="none" style={{ position: "absolute", width: 0, height: 0, overflow: "hidden" }}>
        <path ref={rimRef} d={RIM} />
      </svg>
      <canvas ref={trailRef} aria-hidden="true" className="brand-meteor" style={{ inset: -BLEED }} />
      <canvas ref={shineRef} aria-hidden="true" className="brand-meteor" style={{ inset: -BLEED }} />
    </>
  );
}
