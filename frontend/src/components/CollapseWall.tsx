// The hero is the search space itself. All 1,024 candidate portfolios of a real NIFTY 50 instance
// are printed edge to edge as readable bit strings, lowest energy nearest the focal point, and each
// is as bright as its QAOA probability. Changing layer redraws a hidden canvas once and crossfades
// to it, so nothing runs between steps. Hovering any string reads out the stocks it holds.

import { useEffect, useRef } from "react";
import { energies, feasible, instance, optimumIndex, qaoaProbabilities, SIZE, uniform } from "../lib/qaoa";

const STATES = [uniform, ...instance.schedules.map((s) => qaoaProbabilities(s.gammas, s.betas))];
const PEAK = Math.sqrt(Math.max(...STATES[STATES.length - 1]));
const RANKED = Array.from({ length: SIZE }, (_, index) => index).sort((a, b) => energies[a] - energies[b]);
const BITS = Array.from({ length: SIZE }, (_, index) => Array.from({ length: instance.tickers.length }, (_, i) => (index >> i) & 1).join(""));
const FONT = '"Martian Mono Variable", ui-monospace, monospace';

type Layout = { columns: number; cellW: number; cellH: number; size: number; x: Float32Array; y: Float32Array; at: Int16Array; ratio: number; width: number; height: number };

function measure(width: number, height: number, context: CanvasRenderingContext2D): Layout {
  // How large can a ten-character string be so that all 1,024 fill the area exactly?
  context.font = `500 100px ${FONT}`;
  const textWidth = context.measureText("0000000000").width / 100;
  const lineHeight = 1.5;
  const fit = Math.sqrt((width * height) / (SIZE * (textWidth + 0.5) * lineHeight));
  const columns = Math.max(Math.floor(width / (fit * (textWidth + 0.5))), 2);
  const rows = Math.ceil(SIZE / columns);
  const cellW = width / columns;
  const cellH = height / rows;
  const size = Math.min((cellW * 0.9) / textWidth, cellH * 0.8);

  // The best portfolios gather around a focal point up and to the right of the headline.
  const focalX = width * (width > height ? 0.72 : 0.5);
  const focalY = height * (width > height ? 0.3 : 0.26);
  const cells = Array.from({ length: columns * rows }, (_, cell) => {
    const cx = (cell % columns) * cellW + cellW / 2;
    const cy = Math.floor(cell / columns) * cellH + cellH / 2;
    return { cell, cx, cy, distance: Math.hypot(cx - focalX, (cy - focalY) * 1.6) };
  }).sort((a, b) => a.distance - b.distance);

  const x = new Float32Array(SIZE);
  const y = new Float32Array(SIZE);
  const at = new Int16Array(columns * rows).fill(-1);
  RANKED.forEach((index, rank) => {
    x[index] = cells[rank].cx;
    y[index] = cells[rank].cy;
    at[cells[rank].cell] = index;
  });
  return { columns, cellW, cellH, size, x, y, at, ratio: Math.min(window.devicePixelRatio || 1, 1.5), width, height };
}

function paint(canvas: HTMLCanvasElement, layout: Layout, layer: number) {
  const context = canvas.getContext("2d")!;
  const { ratio, width, height, size, x, y } = layout;
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, height);
  context.textAlign = "center";
  context.textBaseline = "middle";
  const state = STATES[layer];
  for (let index = 0; index < SIZE; index += 1) {
    const value = Math.min((Math.sqrt(state[index]) / PEAK) * 1.7, 1);
    const hot = value > 0.45;
    context.font = `${hot ? 800 : 400} ${size}px ${FONT}`;
    if (index === optimumIndex) {
      context.fillStyle = "#ffc83d";
      context.globalAlpha = Math.max(0.6, value);
    } else {
      context.fillStyle = feasible[index] ? "#3cf5b4" : "#8d9c96";
      context.globalAlpha = 0.11 + 0.89 * value;
    }
    context.fillText(BITS[index], x[index], y[index]);
  }
  context.globalAlpha = 1;
}

export default function CollapseWall({ layer }: { layer: number }) {
  const host = useRef<HTMLDivElement>(null);
  const canvases = useRef<HTMLCanvasElement[]>([]);
  const layout = useRef<Layout | null>(null);
  const front = useRef(0);
  const layerRef = useRef(layer);

  // Set up, and measure again whenever the wall changes size.
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    let cancelled = false;

    const rebuild = () => {
      const [a, b] = canvases.current;
      const context = a?.getContext("2d");
      if (!context || !element.clientWidth || !element.clientHeight) return;
      const next = measure(element.clientWidth, element.clientHeight, context);
      layout.current = next;
      for (const canvas of canvases.current) {
        canvas.width = next.width * next.ratio;
        canvas.height = next.height * next.ratio;
      }
      paint(canvases.current[front.current] ?? a ?? b, next, layerRef.current);
      canvases.current[front.current].classList.add("is-on");
      placeAnswer(element, next);
    };

    // The wall is text, so it waits for the font rather than flashing a fallback.
    void document.fonts.load(`500 12px ${FONT}`).then(() => {
      if (!cancelled) rebuild();
    });
    const observer = new ResizeObserver(() => {
      if (layout.current) rebuild();
    });
    observer.observe(element);
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, []);

  // Each layer change is one redraw of the hidden canvas, then a CSS crossfade.
  useEffect(() => {
    layerRef.current = layer;
    const current = layout.current;
    if (!current) return;
    const next = 1 - front.current;
    paint(canvases.current[next], current, layer);
    canvases.current[next].classList.add("is-on");
    canvases.current[front.current].classList.remove("is-on");
    front.current = next;
  }, [layer]);

  // Reads a string's stocks directly into the DOM, so moving the mouse never re-renders React.
  const cursor = useRef<HTMLDivElement>(null);
  const tip = useRef<HTMLDivElement>(null);
  const last = useRef(-1);
  const onMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const current = layout.current;
    if (!current || !cursor.current || !tip.current) return;
    const box = event.currentTarget.getBoundingClientRect();
    const column = Math.floor((event.clientX - box.left) / current.cellW);
    const row = Math.floor((event.clientY - box.top) / current.cellH);
    const index = current.at[row * current.columns + column] ?? -1;
    if (index === last.current) return;
    last.current = index;
    if (index < 0) return hide();
    const px = current.x[index];
    const py = current.y[index];
    cursor.current.style.width = `${current.cellW}px`;
    cursor.current.style.height = `${current.cellH}px`;
    cursor.current.style.transform = `translate(${px - current.cellW / 2}px, ${py - current.cellH / 2}px)`;
    cursor.current.style.opacity = "1";
    const held = instance.tickers.filter((_, i) => BITS[index][i] === "1");
    const flip = px > current.width - 300;
    tip.current.style.transform = `translate(${flip ? px - current.cellW / 2 - 8 : px + current.cellW / 2 + 8}px, ${py - 14}px) translateX(${flip ? "-100%" : "0"})`;
    tip.current.style.opacity = "1";
    const probability = STATES[layerRef.current][index] * 100;
    tip.current.textContent = `${held.join(" ") || "No stocks"}  ${probability < 0.01 ? "below 0.01" : probability.toFixed(probability < 1 ? 2 : 1)}%`;
  };
  const hide = () => {
    last.current = -1;
    if (cursor.current) cursor.current.style.opacity = "0";
    if (tip.current) tip.current.style.opacity = "0";
  };

  return (
    <div ref={host} className="absolute inset-0 overflow-hidden" onPointerMove={onMove} onPointerLeave={hide} aria-hidden>
      {[0, 1].map((i) => (
        <canvas
          key={i}
          className="wall-frame"
          ref={(node) => {
            if (node) canvases.current[i] = node;
          }}
        />
      ))}
      <div ref={cursor} className="wall-cursor opacity-0" />
      <div ref={tip} className="mono-tight pointer-events-none absolute top-0 left-0 z-10 whitespace-nowrap bg-text px-2 py-1 text-[11px] font-medium text-ink opacity-0" />
    </div>
  );
}

/** Starts the big gold string exactly where the small one sits on the wall. */
function placeAnswer(element: HTMLElement, layout: Layout) {
  const pin = element.closest<HTMLElement>(".stage-pin");
  const bits = pin?.querySelector<HTMLElement>(".answer-bits");
  if (!pin || !bits) return;
  // Layout offsets, because the wall and the string are both mid-transform while scrolling.
  const top = element.parentElement?.offsetTop ?? 0;
  pin.style.setProperty("--ox", `${layout.x[optimumIndex] - (bits.offsetLeft + bits.offsetWidth / 2)}px`);
  pin.style.setProperty("--oy", `${top + layout.y[optimumIndex] - (bits.offsetTop + bits.offsetHeight / 2)}px`);
  pin.style.setProperty("--os", `${(layout.cellW * 0.9) / Math.max(bits.offsetWidth, 1)}`);
}
