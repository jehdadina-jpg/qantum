// All charts are drawn with d3 scales and shapes inside React-managed SVG, so one visual language
// covers every panel. Every chart shows data handed to it. None of them generates values.
//
// Performance: SVG is drawn once and memoised. Hover state lives in a separate small overlay, so
// moving the mouse never rebuilds paths. Entrances animate an HTML wrapper's transform and opacity,
// which the compositor handles without repainting the chart.

import * as d3 from "d3";
import { memo, useEffect, useId, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { BitstringRow, Drawing, Gate, Landscape, Tile } from "../lib/api";
import { useSize } from "../lib/hooks";
import { num, pct, signedPct } from "../lib/format";

export const COLORS = {
  em: "#3cf5b4",
  gold: "#ffc83d",
  loss: "#ff7d5e",
  sky: "#8cc8ff",
  text: "#eff6f3",
  dim: "#a3b4ae",
  faint: "#7f918b",
  line: "rgb(255 255 255 / 0.06)",
  lineStrong: "#33444b",
  ink: "#04070a",
};

export const SERIES: Record<string, string> = {
  "Exact MIQP": COLORS.text,
  "Brute force": COLORS.dim,
  "Simulated annealing": COLORS.sky,
  "Continuous MVO": "#d3df7c",
  "Equal weight": COLORS.faint,
  "NIFTY 50 index": "#c8a6e0",
};

export function seriesColor(label: string) {
  if (SERIES[label]) return SERIES[label];
  if (label.includes("noise")) return COLORS.gold;
  if (label.startsWith("QAOA")) {
    const depth = Number(label.match(/p=(\d+)/)?.[1] ?? 3);
    return d3.interpolateRgb("#16b588", "#8dffd9")(Math.min((depth - 1) / 4, 1));
  }
  return COLORS.dim;
}

const margin = { top: 12, right: 16, bottom: 32, left: 56 };
const monoText = { fontFamily: "var(--font-mono)", fontSize: 9.5 };

/** Labels only the powers of ten on a log axis, so ticks stay readable. */
const decade = (v: number) => (Math.abs(Math.log10(v) % 1) > 1e-9 ? "" : v >= 1 ? d3.format("~s")(v) : d3.format(".0e")(v));

/** Reveals its children left to right with two opposed transforms, so nothing repaints. */
function Wipe({ children }: { children: ReactNode }) {
  return (
    <div className="wipe-outer">
      <div className="wipe-inner">{children}</div>
    </div>
  );
}

function Frame({ children, height = 240, className = "", reveal = "grow" }: { children: (width: number, height: number) => ReactNode; height?: number | string; className?: string; reveal?: "grow" | "wipe" }) {
  const [ref, size] = useSize<HTMLDivElement>();
  const svg =
    size.width > 0 && size.height > 0 ? (
      <svg width={size.width} height={size.height} role="img" className="absolute inset-0 block">
        {children(size.width, size.height)}
      </svg>
    ) : null;
  return (
    <div ref={ref} className={`chart relative w-full ${className}`} style={{ height }}>
      {svg && (reveal === "wipe" ? <Wipe>{svg}</Wipe> : <div className="grow-in absolute inset-0">{svg}</div>)}
    </div>
  );
}

function AxisLeft({ scale, width, ticks = 5, format, label }: { scale: d3.ScaleContinuousNumeric<number, number>; width: number; ticks?: number; format?: (v: number) => string; label?: string }) {
  const values = scale.ticks(ticks);
  const fmt = format ?? scale.tickFormat(ticks);
  return (
    <g>
      {values
        .filter((v) => fmt(v) !== "")
        .map((v) => (
          <g key={v} transform={`translate(0,${scale(v)})`}>
            <line x1={margin.left} x2={width - margin.right} stroke={COLORS.line} />
            <text x={margin.left - 8} dy="0.32em" textAnchor="end" fill={COLORS.dim} {...monoText}>
              {fmt(v)}
            </text>
          </g>
        ))}
      {label && (
        <text transform={`translate(11,${(scale.range()[0] + scale.range()[1]) / 2}) rotate(-90)`} textAnchor="middle" fill={COLORS.dim} fontSize={10.5}>
          {label}
        </text>
      )}
    </g>
  );
}

function AxisBottom({ scale, height, ticks = 6, format, label }: { scale: d3.ScaleContinuousNumeric<number, number>; height: number; ticks?: number; format?: (v: number) => string; label?: string }) {
  // Narrow panels get fewer ticks so labels never collide.
  const values = scale.ticks(Math.min(ticks, Math.max(Math.floor((scale.range()[1] - scale.range()[0]) / 74), 2)));
  const fmt = format ?? scale.tickFormat(ticks);
  const y = height - margin.bottom;
  return (
    <g>
      <line x1={scale.range()[0]} x2={scale.range()[1]} y1={y} y2={y} stroke="rgb(255 255 255 / 0.13)" />
      {values.map((v) => (
        <text key={v} x={scale(v)} y={y + 15} textAnchor={scale(v) > scale.range()[1] - 26 ? "end" : "middle"} fill={COLORS.dim} {...monoText}>
          {fmt(v)}
        </text>
      ))}
      {label && (
        <text x={(scale.range()[0] + scale.range()[1]) / 2} y={height - 2} textAnchor="middle" fill={COLORS.dim} fontSize={10.5}>
          {label}
        </text>
      )}
    </g>
  );
}

export function Legend({ items }: { items: { label: string; color: string; dashed?: boolean }[] }) {
  return (
    <div className="flex flex-wrap gap-x-3.5 gap-y-1.5 text-[11.5px] text-dim">
      {items.map((item) => (
        <span key={item.label} className="flex items-center gap-1.5">
          <span className="h-0 w-3.5 border-t-2" style={{ borderColor: item.color, borderTopStyle: item.dashed ? "dashed" : "solid" }} />
          {item.label}
        </span>
      ))}
    </div>
  );
}

function Tooltip({ x, y, width, children }: { x: number; y: number; width: number; children: ReactNode }) {
  const flip = x > width - 200;
  return (
    <div
      className="pointer-events-none absolute z-20 w-max max-w-[240px] bg-[#0c0f0e] px-2.5 py-2 text-[11.5px] leading-snug shadow-[inset_0_0_0_1px_rgb(255_255_255/0.13)]"
      style={{ left: flip ? undefined : x + 14, right: flip ? width - x + 14 : undefined, top: Math.max(y - 14, 2) }}
    >
      {children}
    </div>
  );
}

export interface FrontierPortfolio {
  label: string;
  vol: number;
  ret: number;
  tickers: string[];
  color: string;
}

export function FrontierChart({
  frontier,
  cloud,
  assets,
  portfolios,
  height = 300,
  tickers,
}: {
  frontier: { ret: number; vol: number }[];
  cloud: { ret: number; vol: number; objective: number; bits: string }[];
  assets: { symbol: string; ret: number; vol: number }[];
  portfolios: FrontierPortfolio[];
  height?: number;
  tickers?: string[];
}) {
  const [ref, size] = useSize<HTMLDivElement>();
  const canvas = useRef<HTMLCanvasElement>(null);
  const [hover, setHover] = useState<{ x: number; y: number; title: string; lines: string[] } | null>(null);

  const scales = useMemo(() => {
    const vols = [...frontier.map((d) => d.vol), ...cloud.map((d) => d.vol), ...assets.map((d) => d.vol)];
    const rets = [...frontier.map((d) => d.ret), ...cloud.map((d) => d.ret), ...assets.map((d) => d.ret)];
    const x = d3.scaleLinear().domain([d3.min(vols)! * 0.94, d3.max(vols)! * 1.04]).range([margin.left, Math.max(size.width - margin.right, margin.left + 1)]);
    const y = d3.scaleLinear().domain(d3.extent(rets) as [number, number]).nice().range([height - margin.bottom, margin.top]);
    const color = d3.scaleSequential(d3.interpolateRgbBasis(["#ff7d5e", "#4a7f80", "#3cf5b4"])).domain(d3.extent(cloud, (d) => -d.objective) as [number, number]);
    return { x, y, color };
  }, [frontier, cloud, assets, size.width, height]);

  useEffect(() => {
    const element = canvas.current;
    if (!element || !size.width) return;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    element.width = size.width * ratio;
    element.height = height * ratio;
    const context = element.getContext("2d")!;
    context.scale(ratio, ratio);
    const dense = cloud.length > 800;
    context.globalAlpha = dense ? 0.42 : 0.85;
    for (const point of cloud) {
      context.fillStyle = scales.color(-point.objective);
      context.beginPath();
      context.arc(scales.x(point.vol), scales.y(point.ret), dense ? 1.6 : 2.6, 0, Math.PI * 2);
      context.fill();
    }
  }, [cloud, scales, size.width, height]);

  // Interactive marks hand their hover text up through data attributes, keeping this SVG static.
  const svg = useMemo(() => {
    if (!size.width) return null;
    const line = d3.line<{ vol: number; ret: number }>().x((d) => scales.x(d.vol)).y((d) => scales.y(d.ret)).curve(d3.curveMonotoneY);
    return (
      <svg width={size.width} height={height} role="img" aria-label="Efficient frontier with candidate portfolios" className="absolute inset-0">
        <AxisLeft scale={scales.y} width={size.width} format={(v) => pct(v, 0)} label="Expected return" />
        <AxisBottom scale={scales.x} height={height} format={(v) => pct(v, 0)} label="Volatility" />
        <path d={line(frontier) ?? ""} fill="none" stroke={COLORS.text} strokeWidth={1.75} strokeLinecap="round" />
        {assets.map((asset) => (
          <rect key={asset.symbol} x={scales.x(asset.vol) - 2.5} y={scales.y(asset.ret) - 2.5} width={5} height={5} fill="none" stroke={COLORS.dim} />
        ))}
        {/* Solvers that picked the same portfolio draw as concentric rings, so none is hidden. */}
        {portfolios
          .map((p, index) => {
            const twins = portfolios.slice(0, index).filter((o) => Math.abs(o.vol - p.vol) < 1e-9 && Math.abs(o.ret - p.ret) < 1e-9).length;
            return { p, radius: 5 + twins * 3.5 };
          })
          .reverse()
          .map(({ p, radius }) => (
            <circle key={p.label} cx={scales.x(p.vol)} cy={scales.y(p.ret)} r={radius} fill={COLORS.ink} stroke={p.color} strokeWidth={1.75} />
          ))}
      </svg>
    );
  }, [frontier, assets, portfolios, scales, size.width, height]);

  const onMove = (event: React.MouseEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const px = event.clientX - box.left;
    const py = event.clientY - box.top;
    let distance = 14 * 14;
    let next: typeof hover = null;
    const test = (vol: number, ret: number, make: () => typeof hover, reach = 1) => {
      const dx = scales.x(vol) - px;
      const dy = scales.y(ret) - py;
      const d = (dx * dx + dy * dy) / reach;
      if (d < distance) {
        distance = d;
        next = make();
      }
    };
    for (const point of cloud) {
      test(point.vol, point.ret, () => ({
        x: scales.x(point.vol),
        y: scales.y(point.ret),
        title: `Candidate ${point.bits}`,
        lines: [`Return ${pct(point.ret)}, volatility ${pct(point.vol)}`, tickers ? tickers.filter((_, i) => point.bits[i] === "1").join(", ") : point.bits],
      }));
    }
    for (const asset of assets) test(asset.vol, asset.ret, () => ({ x: scales.x(asset.vol), y: scales.y(asset.ret), title: asset.symbol, lines: [`Return ${pct(asset.ret)}`, `Volatility ${pct(asset.vol)}`] }), 2);
    for (const p of portfolios) test(p.vol, p.ret, () => ({ x: scales.x(p.vol), y: scales.y(p.ret), title: p.label, lines: [`Return ${pct(p.ret)}, volatility ${pct(p.vol)}`, p.tickers.join(", ")] }), 4);
    const resolved = next as typeof hover;
    setHover((previous) => (previous?.title === resolved?.title ? previous : resolved));
  };

  return (
    <div ref={ref} className="chart relative w-full" style={{ height }} onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
      {size.width > 0 && (
        <>
          <Wipe>
            <canvas ref={canvas} className="absolute inset-0" style={{ width: size.width, height }} />
            {svg}
          </Wipe>
          {hover && (
            <Tooltip x={hover.x} y={hover.y} width={size.width}>
              <div className="font-medium text-text">{hover.title}</div>
              {hover.lines.map((l) => (
                <div key={l} className="text-dim">
                  {l}
                </div>
              ))}
            </Tooltip>
          )}
        </>
      )}
    </div>
  );
}

export function Donut({ weights, centre, caption, size = 180 }: { weights: Record<string, number>; centre: string; caption: string; size?: number }) {
  const entries = Object.entries(weights).sort((a, b) => b[1] - a[1]);
  const palette = d3.quantize(d3.interpolateRgbBasis(["#3cf5b4", "#8cc8ff", "#ffc83d", "#2fb596", "#dff5ec"]), Math.max(entries.length, 2));
  const pie = d3.pie<[string, number]>().value((d) => d[1]).sort(null).padAngle(0.012);
  const arc = d3.arc<d3.PieArcDatum<[string, number]>>().innerRadius(size / 2 - 19).outerRadius(size / 2 - 2);
  const signature = entries.map(([ticker]) => ticker).join();
  return (
    <div className="flex flex-wrap items-center gap-6">
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg key={signature} width={size} height={size} viewBox={`${-size / 2} ${-size / 2} ${size} ${size}`} role="img" aria-label="Portfolio allocation" className="spin-in absolute inset-0">
          {pie(entries).map((slice, i) => (
            <path key={slice.data[0]} d={arc(slice) ?? ""} fill={palette[i]} />
          ))}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="display text-[34px] leading-none">{centre}</span>
          <span className="mt-1 text-[11px] text-dim">{caption}</span>
        </div>
      </div>
      <ul className="grid min-w-0 flex-1 gap-1.5 text-[12.5px]">
        {entries.map(([ticker, weight], i) => (
          <li key={ticker} className="flex items-center justify-between gap-3">
            <span className="flex min-w-0 items-center gap-2">
              <span className="size-2 shrink-0" style={{ background: palette[i] }} />
              <span className="truncate">{ticker}</span>
            </span>
            <span className="mono-tight text-[11.5px] text-dim tnum">{pct(weight, 1)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

type LineSeries = { label: string; color: string; points: [number, number][]; dashed?: boolean; dots?: boolean; band?: [number, number, number][]; width?: number; fill?: boolean };

export function LineChart({
  series,
  height = 220,
  xLabel,
  yLabel,
  xLog,
  yLog,
  xFormat,
  yFormat,
  markers,
  xDomain,
  yDomain,
}: {
  series: LineSeries[];
  height?: number | string;
  xLabel?: string;
  yLabel?: string;
  xLog?: boolean;
  yLog?: boolean;
  xFormat?: (v: number) => string;
  yFormat?: (v: number) => string;
  markers?: { x?: number; y?: number; label?: string; color?: string }[];
  xDomain?: [number, number];
  yDomain?: [number, number];
}) {
  const [ref, size] = useSize<HTMLDivElement>();
  const id = useId().replace(/:/g, "");
  const [hover, setHover] = useState<number | null>(null);
  const width = size.width;
  const h = size.height;

  // Parents rebuild these arrays on every render, so the chart keys on what the data actually is.
  const signature = series.map((s) => `${s.label}|${s.points.length}|${s.points[0]}|${s.points[s.points.length - 1]}|${s.color}`).join(";") + JSON.stringify(markers ?? null) + JSON.stringify([xDomain, yDomain]);

  const model = useMemo(() => {
    if (!width || !h) return null;
    const all = series.flatMap((s) => s.points).filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
    if (!all.length) return null;
    const bandValues = series.flatMap((s) => (s.band ?? []).flatMap(([, a, b]) => [a, b]));
    const yValues = [...all.map((d) => d[1]), ...bandValues, ...(markers ?? []).flatMap((m) => (m.y === undefined ? [] : [m.y]))];
    const xr: [number, number] = [margin.left, width - margin.right];
    const yr: [number, number] = [h - margin.bottom, margin.top];
    const xExtent = xDomain ?? (d3.extent(all, (d) => d[0]) as [number, number]);
    const yExtent = yDomain ?? (d3.extent(yValues) as [number, number]);
    const x = xLog ? d3.scaleLog().domain(xExtent).range(xr) : d3.scaleLinear().domain(xExtent).range(xr);
    const y = yLog ? d3.scaleLog().domain(yExtent).nice().range(yr) : d3.scaleLinear().domain(yExtent).nice().range(yr);
    const xs = Array.from(new Set(all.map((d) => d[0]))).sort((a, b) => a - b);
    return { x, y, xs };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, width, h, xLog, yLog]);

  const chart = useMemo(() => {
    if (!model) return null;
    return (
      <svg width={width} height={h} role="img" className="absolute inset-0 block">
        <defs>
          {series.map((s, i) => (
            <linearGradient key={s.label} id={`${id}-fill-${i}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={s.color} stopOpacity={0.26} />
              <stop offset="100%" stopColor={s.color} stopOpacity={0} />
            </linearGradient>
          ))}
        </defs>
        <AxisLeft scale={model.y} width={width} format={yFormat ?? (yLog ? decade : undefined)} label={yLabel} ticks={yLog ? 4 : 5} />
        <AxisBottom scale={model.x} height={h} format={xFormat ?? (xLog ? decade : undefined)} label={xLabel} ticks={xLog ? 5 : 6} />
        {series.map((s, i) => {
          const showFill = s.fill ?? series.length === 1;
          if (!showFill || yLog || !s.points.length) return null;
          const area = d3
            .area<[number, number]>()
            .x((d) => model.x(d[0]))
            .y0(h - margin.bottom)
            .y1((d) => model.y(d[1]));
          return <path key={`${s.label}-area`} d={area(s.points) ?? ""} fill={`url(#${id}-fill-${i})`} />;
        })}
        {series.map(
          (s) =>
            s.band && (
              <path
                key={`${s.label}-band`}
                d={
                  d3
                    .area<[number, number, number]>()
                    .x((d) => model.x(d[0]))
                    .y0((d) => model.y(d[1]))
                    .y1((d) => model.y(d[2]))(s.band) ?? ""
                }
                fill={s.color}
                opacity={0.12}
              />
            ),
        )}
        {series.map((s) => {
          const path = d3
            .line<[number, number]>()
            .x((d) => model.x(d[0]))
            .y((d) => model.y(d[1]))
            .defined((d) => Number.isFinite(d[0]) && Number.isFinite(d[1]));
          return (
            <g key={s.label}>
              <path d={path(s.points) ?? ""} fill="none" stroke={s.color} strokeWidth={s.width ?? 1.6} strokeDasharray={s.dashed ? "4 3" : undefined} strokeLinejoin="round" strokeLinecap="round" />
              {s.dots && s.points.map(([px, py]) => <circle key={`${px}-${py}`} cx={model.x(px)} cy={model.y(py)} r={2.75} fill={COLORS.ink} stroke={s.color} strokeWidth={1.5} />)}
            </g>
          );
        })}
        {(markers ?? []).map((m, i) =>
          m.x !== undefined ? (
            <g key={i}>
              <line x1={model.x(m.x)} x2={model.x(m.x)} y1={margin.top} y2={h - margin.bottom} stroke={m.color ?? COLORS.gold} strokeDasharray="3 3" />
              {m.label && (
                <text x={model.x(m.x) + 5} y={margin.top + 10} fill={m.color ?? COLORS.gold} {...monoText}>
                  {m.label}
                </text>
              )}
            </g>
          ) : (
            <g key={i}>
              <line x1={margin.left} x2={width - margin.right} y1={model.y(m.y!)} y2={model.y(m.y!)} stroke={m.color ?? COLORS.gold} strokeDasharray="3 3" />
              {m.label && (
                <text x={width - margin.right - 2} y={model.y(m.y!) + 14} textAnchor="end" fill={m.color ?? COLORS.gold} {...monoText}>
                  {m.label}
                </text>
              )}
            </g>
          ),
        )}
      </svg>
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model, width, h, id, xLabel, yLabel]);

  const readout = (v: number) => (yFormat ? yFormat(v) : d3.format(".4~g")(v));

  return (
    <div
      ref={ref}
      className="chart relative w-full"
      style={{ height }}
      onMouseLeave={() => setHover(null)}
      onMouseMove={(event) => {
        if (!model) return;
        const box = event.currentTarget.getBoundingClientRect();
        // React skips the render when the nearest point has not changed.
        setHover(model.xs[d3.bisectCenter(model.xs, model.x.invert(event.clientX - box.left))]);
      }}
    >
      {chart && <Wipe>{chart}</Wipe>}
      {model && hover !== null && (
        <>
          <svg width={width} height={h} className="pointer-events-none absolute inset-0 block">
            <line x1={model.x(hover)} x2={model.x(hover)} y1={margin.top} y2={h - margin.bottom} stroke="rgb(255 255 255 / 0.28)" />
            {series.map((s) => {
              const point = s.points.find((d) => d[0] === hover);
              if (!point || !Number.isFinite(point[1])) return null;
              return <circle key={s.label} cx={model.x(point[0])} cy={model.y(point[1])} r={3.5} fill={s.color} stroke={COLORS.ink} strokeWidth={1.5} />;
            })}
          </svg>
          <Tooltip x={model.x(hover)} y={margin.top} width={width}>
            <div className="mono-tight mb-1 text-[11px] text-dim">{xFormat ? xFormat(hover) : d3.format(".4~g")(hover)}</div>
            {series.slice(0, 9).map((s) => {
              const point = s.points.find((d) => d[0] === hover);
              if (!point) return null;
              return (
                <div key={s.label} className="flex items-center justify-between gap-4">
                  <span className="flex items-center gap-1.5 text-dim">
                    <span className="size-1.5" style={{ background: s.color }} />
                    {s.label}
                  </span>
                  <span className="mono-tight text-[11px] text-text tnum">{readout(point[1])}</span>
                </div>
              );
            })}
          </Tooltip>
        </>
      )}
    </div>
  );
}

export function BitstringBars({ rows, height = 220, tickers }: { rows: BitstringRow[]; height?: number; tickers?: string[] }) {
  const id = useId().replace(/:/g, "");
  const [hover, setHover] = useState<number | null>(null);
  const top = rows.slice(0, 24);
  return (
    <div className="relative">
      <Frame height={height}>
        {(width, h) => {
          const x = d3.scaleBand<number>().domain(top.map((_, i) => i)).range([margin.left, width - margin.right]).padding(0.2);
          const y = d3.scaleLinear().domain([0, d3.max(top, (d) => d.probability) ?? 1]).nice().range([h - 22, margin.top]);
          return (
            <>
              <defs>
                <linearGradient id={`${id}-good`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#8dffd9" />
                  <stop offset="100%" stopColor="#16b588" />
                </linearGradient>
              </defs>
              <AxisLeft scale={y} width={width} format={(v) => pct(v, 0)} />
              {top.map((row, i) => (
                <g key={row.bits} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
                  <rect x={x(i)} y={margin.top} width={x.bandwidth()} height={h - 22 - margin.top} fill="transparent" />
                  <rect
                    x={x(i)}
                    y={y(row.probability)}
                    width={x.bandwidth()}
                    height={h - 22 - y(row.probability)}
                   
                    fill={row.feasible ? `url(#${id}-good)` : COLORS.lineStrong}
                    opacity={hover === null || hover === i ? 1 : 0.45}
                  />
                </g>
              ))}
            </>
          );
        }}
      </Frame>
      <div className="flex min-h-[38px] items-center px-4 pb-2.5 text-[11.5px] text-dim">
        {hover !== null ? (
          <span className="mono-tight tnum">
            <span className="text-text">{top[hover].bits}</span> P {pct(top[hover].probability, 2)}, E {num(top[hover].energy, 3)}, {top[hover].feasible ? "feasible" : "infeasible"}
            {tickers && top[hover].feasible && <span className="block truncate text-faint">{tickers.filter((_, i) => top[hover].bits[i] === "1").join(" ")}</span>}
          </span>
        ) : (
          <span>Hover a bar to read the bit string. Green strings satisfy the cardinality constraint.</span>
        )}
      </div>
    </div>
  );
}

export function HeatMatrix({
  matrix,
  labels,
  height = 300,
  diverging = true,
  compress = false,
  caption,
}: {
  matrix: number[][];
  labels: string[];
  height?: number;
  diverging?: boolean;
  compress?: boolean;
  caption?: (i: number, j: number, value: number) => string;
}) {
  const [hover, setHover] = useState<[number, number] | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const n = matrix.length;
  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const flat = matrix.flat();
    const limit = d3.max(flat, (v) => Math.abs(v)) ?? 1;
    const cell = Math.max(Math.floor(480 / n), 6);
    const gap = n <= 20 ? 2 : 1;
    element.width = n * cell;
    element.height = n * cell;
    const context = element.getContext("2d")!;
    // `compress` uses a square-root ramp, which keeps small off-diagonal structure visible
    // beside a bright diagonal. Correlations stay linear so their spread reads honestly.
    const low = d3.min(flat)!;
    const high = d3.max(flat)!;
    const positive = d3.interpolateRgbBasis(["#101c21", "#0f8f6e", "#3cf5b4", "#c9ffec"]);
    const negative = d3.interpolateRgbBasis(["#101c21", "#b8452c", "#ff7d5e"]);
    const sequential = d3.interpolateRgbBasis(["#101c21", "#0f8f6e", "#3cf5b4"]);
    const ramp = diverging
      ? (v: number) => {
          const t = compress ? Math.sqrt(Math.abs(v) / limit) : Math.abs(v) / limit;
          return v >= 0 ? positive(t) : negative(t);
        }
      : (v: number) => sequential((v - low) / Math.max(high - low, 1e-12));
    matrix.forEach((row, i) =>
      row.forEach((value, j) => {
        context.fillStyle = ramp(value);
        context.beginPath();
        context.rect(j * cell + gap / 2, i * cell + gap / 2, cell - gap, cell - gap);
        context.fill();
      }),
    );
  }, [matrix, n, diverging, compress]);
  return (
    <div className="mx-auto w-full px-4 pt-2" style={{ maxWidth: height + 32 }}>
      <div className="relative aspect-square w-full">
        <Wipe>
          <canvas
            ref={canvas}
            aria-label="Matrix heatmap"
            className="size-full"
            onMouseLeave={() => setHover(null)}
            onMouseMove={(event) => {
              const box = event.currentTarget.getBoundingClientRect();
              const row = Math.min(Math.floor(((event.clientY - box.top) / box.height) * n), n - 1);
              const column = Math.min(Math.floor(((event.clientX - box.left) / box.width) * n), n - 1);
              setHover((previous) => (previous?.[0] === row && previous?.[1] === column ? previous : [row, column]));
            }}
          />
        </Wipe>
      </div>
      <p className="min-h-9 py-2.5 text-[11.5px] text-dim">
        {hover ? <span className="mono-tight tnum">{caption ? caption(hover[0], hover[1], matrix[hover[0]][hover[1]]) : `${labels[hover[0]]} x ${labels[hover[1]]}: ${num(matrix[hover[0]][hover[1]], 3)}`}</span> : "Hover a cell to read its value."}
      </p>
    </div>
  );
}

export function LandscapeChart({ landscape, height = 260 }: { landscape: Landscape; height?: number }) {
  const [ref, size] = useSize<HTMLDivElement>();
  const canvas = useRef<HTMLCanvasElement>(null);
  const { energy, gammas, betas, minimum, optimised } = landscape;
  const ready = size.width > 0;
  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const rows = energy.length;
    const cols = energy[0].length;
    element.width = cols;
    element.height = rows;
    const context = element.getContext("2d")!;
    const color = d3.scaleSequential(d3.interpolateRgbBasis(["#ffe7a8", "#3cf5b4", "#14907a", "#0c4644", "#08181c", "#050b0f"])).domain(d3.extent(energy.flat()) as [number, number]);
    energy.forEach((row, i) =>
      row.forEach((value, j) => {
        context.fillStyle = color(value);
        context.fillRect(j, rows - 1 - i, 1, 1);
      }),
    );
    // The canvas only exists once the container has been measured.
  }, [energy, ready]);
  const width = size.width;

  // Topographic contours of the same grid, which make the shape of the landscape readable.
  const overlay = useMemo(() => {
    if (!width) return null;
    const x = d3.scaleLinear().domain([gammas[0], gammas[gammas.length - 1]]).range([margin.left, width - margin.right]);
    const y = d3.scaleLinear().domain([betas[0], betas[betas.length - 1]]).range([height - margin.bottom, margin.top]);
    const rows = energy.length;
    const cols = energy[0].length;
    const values = new Array(rows * cols);
    energy.forEach((row, i) => row.forEach((value, j) => (values[i * cols + j] = value)));
    const shapes = d3.contours().size([cols, rows]).thresholds(11)(values);
    const plotW = width - margin.left - margin.right;
    const plotH = height - margin.top - margin.bottom;
    const path = d3.geoPath(
      d3.geoTransform({
        point(px, py) {
          (this as unknown as { stream: { point(a: number, b: number): void } }).stream.point(margin.left + (px / cols) * plotW, margin.top + plotH - (py / rows) * plotH);
        },
      }),
    );
    return (
      <svg width={width} height={height} className="absolute inset-0">
        {shapes.map((shape) => (
          <path key={shape.value} d={path(shape) ?? ""} fill="none" stroke="rgb(255 255 255 / 0.16)" strokeWidth={0.75} />
        ))}
        {y.ticks(4).map((v) => (
          <text key={v} x={margin.left - 8} y={y(v)} dy="0.32em" textAnchor="end" fill={COLORS.dim} {...monoText}>
            {num(v, 1)}
          </text>
        ))}
        <text transform={`translate(11,${height / 2 - 6}) rotate(-90)`} textAnchor="middle" fill={COLORS.dim} fontSize={10.5}>
          Mixer angle
        </text>
        <AxisBottom scale={x} height={height} ticks={5} label="Cost angle (normalised)" format={(v) => num(v, 0)} />
        <circle cx={x(minimum.gamma)} cy={y(minimum.beta)} r={4.5} fill="none" stroke={COLORS.ink} strokeWidth={1.75} />
        {optimised && <path transform={`translate(${x(optimised.gamma)},${y(optimised.beta)})`} d="M-4,-4L4,4M-4,4L4,-4" stroke={COLORS.ink} strokeWidth={2} strokeLinecap="round" />}
      </svg>
    );
  }, [energy, gammas, betas, minimum, optimised, width, height]);

  return (
    <div ref={ref} className="chart relative w-full" style={{ height }}>
      {ready && (
        <Wipe>
          <canvas
            ref={canvas}
            aria-label="Exact QAOA energy landscape at depth one"
            className="absolute"
            style={{ left: margin.left, top: margin.top, width: width - margin.left - margin.right, height: height - margin.top - margin.bottom }}
          />
          {overlay}
        </Wipe>
      )}
    </div>
  );
}

const TreeTile = memo(function TreeTile({ tile, index, left, top, width, height, color, value, selected, onSelect }: { tile: Tile; index: number; left: number; top: number; width: number; height: number; color: string; value: number | null; selected: boolean; onSelect: (symbol: string) => void }) {
  return (
    <button
      onClick={() => onSelect(tile.symbol)}
      title={`${tile.name}: ${signedPct(value)}`}
      aria-label={`${tile.name}: ${signedPct(value)}`}
      className={`tile-in absolute overflow-hidden px-2 py-1.5 text-left transition-[background-color] duration-300 ease-out ${selected ? "z-[1] shadow-[inset_0_0_0_2px_var(--color-text)]" : "shadow-[inset_0_1px_0_rgb(255_255_255/0.14)] hover:shadow-[inset_0_0_0_1px_rgb(255_255_255/0.5)]"}`}
      style={{ "--i": index, left, top, width, height, backgroundColor: color, backgroundImage: "linear-gradient(155deg, rgb(255 255 255 / 0.1), transparent 55%)" } as CSSProperties}
    >
      {width > 46 && height > 26 && (
        <>
          <span className="block truncate leading-tight font-semibold tracking-tight text-white" style={{ fontSize: Math.min(Math.max(width / 9, 11), 17), fontStretch: "110%" }}>
            {tile.symbol}
          </span>
          {height > 46 && <span className="mono-tight mt-0.5 block text-[11px] leading-tight text-white/85 tnum">{signedPct(value, 1)}</span>}
        </>
      )}
    </button>
  );
});

export function Treemap({
  tiles,
  horizon,
  selected,
  onSelect,
  height = 460,
}: {
  tiles: Tile[];
  horizon: string;
  selected: string | null;
  onSelect: (symbol: string) => void;
  height?: number;
}) {
  const [ref, size] = useSize<HTMLDivElement>();
  const layout = useMemo(() => {
    if (!size.width) return [];
    const root = d3
      .hierarchy<{ children?: Tile[] } & Partial<Tile>>({ children: tiles })
      .sum((d) => (d.symbol ? Math.max(d.weight ?? 0.002, 0.002) : 0))
      .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
    d3.treemap<{ children?: Tile[] } & Partial<Tile>>().size([size.width, height]).paddingInner(1).round(true)(root);
    return root.leaves() as unknown as (d3.HierarchyRectangularNode<Tile> & { x0: number; x1: number; y0: number; y1: number })[];
  }, [tiles, size.width, height]);
  const limit = horizon === "1Y" ? 0.5 : horizon === "3M" ? 0.2 : horizon === "1M" ? 0.1 : horizon === "1W" ? 0.05 : 0.025;
  const color = d3.scaleLinear<string>().domain([-limit, 0, limit]).range(["#d34a2c", "#16252a", "#11b98c"]).clamp(true);
  return (
    <div ref={ref} className="relative w-full" style={{ height }}>
      {layout.map((leaf, index) => {
        const value = leaf.data.returns[horizon];
        return (
          <TreeTile
            key={leaf.data.symbol}
            tile={leaf.data}
            index={index}
            left={leaf.x0}
            top={leaf.y0}
            width={leaf.x1 - leaf.x0}
            height={leaf.y1 - leaf.y0}
            value={value}
            color={value === null ? "#16252a" : color(value)}
            selected={selected === leaf.data.symbol}
            onSelect={onSelect}
          />
        );
      })}
    </div>
  );
}

export function Spark({ values, color = COLORS.em, width = 120, height = 32 }: { values: number[]; color?: string; width?: number; height?: number }) {
  const id = useId().replace(/:/g, "");
  const x = d3.scaleLinear().domain([0, values.length - 1]).range([1, width - 1]);
  const y = d3.scaleLinear().domain(d3.extent(values) as [number, number]).range([height - 3, 3]);
  const line = d3.line<number>().x((_, i) => x(i)).y((v) => y(v));
  const area = d3.area<number>().x((_, i) => x(i)).y0(height).y1((v) => y(v));
  return (
    <div className="relative max-w-full" style={{ width, height }}>
      {/* Keyed on the data, so selecting a different stock wipes its line in. */}
      <div key={`${values[0]}-${values[values.length - 1]}`} className="wipe-outer">
        <div className="wipe-inner">
          <svg width={width} height={height} aria-hidden className="block max-w-full">
            <defs>
              <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity={0.28} />
                <stop offset="100%" stopColor={color} stopOpacity={0} />
              </linearGradient>
            </defs>
            <path d={area(values) ?? ""} fill={`url(#${id})`} />
            <path d={line(values) ?? ""} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" />
          </svg>
        </div>
      </div>
    </div>
  );
}

export function LossHistogram({ grid, probabilities, var: varValue, cvar, height = 260 }: { grid: number[]; probabilities: number[]; var: number; cvar: number; height?: number }) {
  return (
    <Frame height={height}>
      {(width, h) => {
        const step = grid[1] - grid[0];
        const x = d3.scaleLinear().domain([grid[0] - step / 2, grid[grid.length - 1] + step / 2]).range([margin.left, width - margin.right]);
        const y = d3.scaleLinear().domain([0, d3.max(probabilities)!]).nice().range([h - margin.bottom, margin.top]);
        return (
          <>
            <AxisLeft scale={y} width={width} format={(v) => pct(v, 0)} label="Probability" />
            {grid.map((g, i) => (
              <rect
                key={g}
                x={x(g - step / 2) + 0.75}
                width={Math.max(x(g + step / 2) - x(g - step / 2) - 1.5, 1)}
                y={y(probabilities[i])}
                height={h - margin.bottom - y(probabilities[i])}
               
                fill={g >= varValue ? COLORS.loss : COLORS.em}
                opacity={g >= varValue ? 0.95 : 0.72}
              />
            ))}
            <AxisBottom scale={x} height={h} format={(v) => pct(v, 1)} label="Portfolio loss" />
            {[
              { value: varValue, label: "VaR", color: COLORS.gold, row: 0 },
              { value: cvar, label: "CVaR", color: COLORS.text, row: 1 },
            ].map((m) => (
              <g key={m.label}>
                <line x1={x(m.value)} x2={x(m.value)} y1={margin.top} y2={h - margin.bottom} stroke={m.color} strokeDasharray="3 3" />
                <text x={x(m.value) + 5} y={margin.top + 10 + m.row * 14} fill={m.color} {...monoText}>
                  {m.label} {pct(m.value, 2)}
                </text>
              </g>
            ))}
          </>
        );
      }}
    </Frame>
  );
}

export function BarsChart({ counts, edges, height = 220, color = COLORS.em, xLabel, markers }: { counts: number[]; edges: number[]; height?: number; color?: string; xLabel?: string; markers?: { x: number; label: string; color: string }[] }) {
  return (
    <Frame height={height}>
      {(width, h) => {
        const x = d3.scaleLinear().domain([edges[0], edges[edges.length - 1]]).range([margin.left, width - margin.right]);
        const y = d3.scaleLinear().domain([0, d3.max(counts)!]).nice().range([h - margin.bottom, margin.top]);
        return (
          <>
            <AxisLeft scale={y} width={width} ticks={4} format={(v) => d3.format("~s")(v)} />
            {counts.map((c, i) => (
              <rect key={`${i}-${edges[i]}`} x={x(edges[i]) + 0.5} width={Math.max(x(edges[i + 1]) - x(edges[i]) - 1, 1)} y={y(c)} height={h - margin.bottom - y(c)} fill={edges[i + 1] <= 0 ? COLORS.loss : color} opacity={0.82} />
            ))}
            <AxisBottom scale={x} height={h} format={(v) => pct(v, 0)} label={xLabel} />
            {(markers ?? []).map((m) => (
              <g key={m.label}>
                <line x1={x(m.x)} x2={x(m.x)} y1={margin.top} y2={h - margin.bottom} stroke={m.color} strokeDasharray="3 3" />
                <text x={x(m.x) + 5} y={margin.top + 10} fill={m.color} {...monoText}>
                  {m.label}
                </text>
              </g>
            ))}
          </>
        );
      }}
    </Frame>
  );
}

export function FanChart({ fan, samples, height = 280, color = COLORS.em }: { fan: { p05: number[]; p25: number[]; p50: number[]; p75: number[]; p95: number[] }; samples?: number[][]; height?: number; color?: string }) {
  const id = useId().replace(/:/g, "");
  return (
    <Frame height={height} reveal="wipe">
      {(width, h) => {
        const steps = fan.p50.length;
        const x = d3.scaleLinear().domain([0, steps - 1]).range([margin.left, width - margin.right]);
        const y = d3.scaleLinear().domain([d3.min(fan.p05)!, d3.max(fan.p95)!]).nice().range([h - margin.bottom, margin.top]);
        const area = (low: number[], high: number[]) => d3.area<number>().x((_, i) => x(i)).y0((_, i) => y(low[i])).y1((_, i) => y(high[i])).curve(d3.curveMonotoneX)(low) ?? "";
        const line = d3.line<number>().x((_, i) => x(i)).y((v) => y(v));
        return (
          <>
            <defs>
              <clipPath id={`${id}-plot`}>
                <rect x={margin.left} y={margin.top} width={width - margin.left - margin.right} height={h - margin.top - margin.bottom} />
              </clipPath>
            </defs>
            <AxisLeft scale={y} width={width} format={(v) => num(v, 2)} label="Portfolio value" />
            <g clipPath={`url(#${id}-plot)`}>
              <path d={area(fan.p05, fan.p95)} fill={color} opacity={0.11} />
              <path d={area(fan.p25, fan.p75)} fill={color} opacity={0.18} />
              {(samples ?? []).slice(0, 14).map((sample, i) => (
                <path key={i} d={line(sample) ?? ""} fill="none" stroke={COLORS.dim} strokeWidth={0.5} opacity={0.32} />
              ))}
              <path d={line(fan.p50) ?? ""} fill="none" stroke={color} strokeWidth={1.9} />
            </g>
            <line x1={margin.left} x2={width - margin.right} y1={y(1)} y2={y(1)} stroke={COLORS.gold} strokeDasharray="3 3" />
            <AxisBottom scale={x} height={h} format={(v) => num(v, 0)} label="Trading sessions" />
          </>
        );
      }}
    </Frame>
  );
}

const GATE_COLOR: Record<string, string> = { h: COLORS.em, rz: "#2f7fb0", rx: COLORS.gold };

/** Removes the cardinality penalty from a QUBO matrix, which otherwise dominates any colour scale. */
export function withoutPenalty(Q: number[][], penalty: number, K: number) {
  return Q.map((row, i) => row.map((value, j) => (i === j ? value - penalty * (1 - 2 * K) : value - penalty)));
}

export const CircuitDiagram = memo(function CircuitDiagram({ drawing, maxWidth, zoom = 1 }: { drawing: Drawing; maxWidth?: number; zoom?: number }) {
  const cell = 30;
  const rowHeight = 30;
  const left = 36;
  const width = left + (drawing.columns + 1) * cell + 16;
  const height = drawing.qubits * rowHeight + 16;
  const yOf = (q: number) => 8 + rowHeight * q + rowHeight / 2;
  const xOf = (gate: Gate) => left + gate.column * cell + cell / 2;
  const scale = maxWidth && width * zoom > maxWidth ? maxWidth / width : zoom;
  // Keyed on the circuit, so a new size wipes in from the left, the direction it executes.
  const signature = `${drawing.qubits}-${drawing.columns}-${drawing.gates.length}`;
  return (
    <div className="overflow-x-auto">
      <div className="relative" style={{ width: width * scale, height: height * scale }}>
        <div key={signature} className="wipe-outer">
          <div className="wipe-inner">
            <svg width={width * scale} height={height * scale} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Quantum circuit with ${drawing.qubits} qubits`} className="chart block">
              {Array.from({ length: drawing.qubits }, (_, q) => (
                <g key={q}>
                  <text x={2} y={yOf(q)} dy="0.32em" fill={COLORS.dim} {...monoText}>
                    q{q}
                  </text>
                  <line x1={left - 6} x2={width - 8} y1={yOf(q)} y2={yOf(q)} stroke="rgb(255 255 255 / 0.16)" />
                </g>
              ))}
              {drawing.gates.map((gate, i) => {
                const x = xOf(gate);
                if (gate.name === "measure") {
                  return (
                    <g key={i} transform={`translate(${x},${yOf(gate.qubits[0])})`}>
                      <rect x={-10.5} y={-10.5} width={21} height={21} fill="#0c0f0e" stroke="rgb(255 255 255 / 0.4)" />
                      <path d="M-6,4 A7,7 0 0 1 6,4 M0,4 L5,-5" fill="none" stroke={COLORS.text} strokeWidth={1} strokeLinecap="round" />
                    </g>
                  );
                }
                if (gate.qubits.length === 2) {
                  const [a, b] = gate.qubits;
                  return (
                    <g key={i}>
                      <line x1={x} x2={x} y1={yOf(a)} y2={yOf(b)} stroke={COLORS.em} strokeWidth={1.4} />
                      <circle cx={x} cy={yOf(a)} r={3.5} fill={COLORS.em} />
                      <circle cx={x} cy={yOf(b)} r={3.5} fill={COLORS.em} />
                    </g>
                  );
                }
                const fill = GATE_COLOR[gate.name] ?? "#33444b";
                return (
                  <g key={i} transform={`translate(${x},${yOf(gate.qubits[0])})`}>
                    <rect x={-11.5} y={-10.5} width={23} height={21} fill={fill} />
                    <text textAnchor="middle" dy="0.34em" fill={gate.name === "rz" ? COLORS.text : COLORS.ink} fontFamily="var(--font-mono)" fontSize={8.5} fontWeight={600}>
                      {gate.name === "h" ? "H" : gate.name.toUpperCase()}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>
        </div>
      </div>
    </div>
  );
});
