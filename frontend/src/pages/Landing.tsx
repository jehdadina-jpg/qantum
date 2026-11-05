import { ArrowRight, ArrowUpRight, Plus } from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { CircuitDiagram, COLORS, HeatMatrix, withoutPenalty } from "../components/charts";
import CollapseWall from "../components/CollapseWall";
import { Digits, Value } from "../components/Digits";
import { Equation, type EquationName } from "../components/Equation";
import { TransitionLink } from "../components/TransitionLink";
import { Wordmark } from "../components/Wordmark";
import type { BenchmarkResult, Drawing, Gate, Run, RunHeader } from "../lib/api";
import { useFetch } from "../lib/hooks";
import { date, int, num, pct } from "../lib/format";
import { prefersReducedMotion, useRise, useSeen } from "../lib/motion";
import { describe, energies, feasible, instance, optimumIndex, qaoaProbabilities, SIZE, topStrings } from "../lib/qaoa";

const LAST_LAYER = instance.schedules.length;
const LAYER_MS = 620;

const successAt = (layer: number) => (layer === 0 ? 1 / SIZE : instance.schedules[layer - 1].success);

function Reveal({ children, className = "" }: { children: ReactNode; className?: string }) {
  const ref = useRise<HTMLDivElement>();
  return (
    <div ref={ref} className={`rise ${className}`}>
      {children}
    </div>
  );
}

/** Scrolls within the page without touching the URL, which may be holding the route. */
function jump(event: React.MouseEvent<HTMLAnchorElement>) {
  event.preventDefault();
  document.getElementById(event.currentTarget.hash.slice(1))?.scrollIntoView();
}

function Nav() {
  const link = "hidden items-center px-3.5 text-[13px] font-semibold text-dim transition-colors duration-100 hover:text-text sm:flex";
  return (
    <header className="fixed inset-x-0 top-0 z-40 flex h-12 items-stretch justify-between border-b border-line bg-ink pl-4 md:pl-5">
      <a href="#top" onClick={jump} className="flex items-center" aria-label="QANTUM home">
        <Wordmark className="text-[17px]" />
      </a>
      <nav className="flex items-stretch" aria-label="Main">
        <a href="#how" onClick={jump} className={link}>
          How it works
        </a>
        <a href="#play" onClick={jump} className={link}>
          Try it
        </a>
        <TransitionLink to="/team" className="flex items-center px-3.5 text-[13px] font-semibold text-dim transition-colors duration-100 hover:text-text">
          Team
        </TransitionLink>
        <TransitionLink to="/terminal/optimise" className="fill-button flex items-center px-4 text-[13px] font-bold whitespace-nowrap md:px-5">
          Open terminal
        </TransitionLink>
      </nav>
    </header>
  );
}

/** Runs the collapse once on load, then rests. Nothing moves until someone asks it to. */
function useCollapse() {
  const reduced = useMemo(prefersReducedMotion, []);
  const [layer, setLayer] = useState(reduced ? LAST_LAYER : 0);
  const timers = useRef<number[]>([]);
  const stop = () => {
    timers.current.forEach((timer) => window.clearTimeout(timer));
    timers.current = [];
  };
  const play = (delay = 0) => {
    stop();
    setLayer(0);
    for (let next = 1; next <= LAST_LAYER; next += 1) {
      timers.current.push(window.setTimeout(() => setLayer(next), delay + next * LAYER_MS));
    }
  };
  useEffect(() => {
    if (!reduced) play(900);
    return stop;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return {
    layer,
    play: () => play(250),
    jump: (next: number) => {
      stop();
      setLayer(next);
    },
  };
}

function Stage() {
  const { layer, play, jump } = useCollapse();
  const success = successAt(layer);
  const held = instance.names.filter((_, i) => instance.optimum[i] === 1).map((name) => name.replace(/\s+Ltd\.?$/, ""));
  return (
    <div id="top" className="stage">
      <div className="stage-pin">
        <section className="stage-hero">
          <div className="stage-wall absolute inset-0 top-12">
            <CollapseWall layer={layer} />
          </div>
          {/* A floor of ink under the headline, so the type always sits on solid ground. */}
          <div className="stage-copy pointer-events-none absolute inset-x-0 bottom-0 flex flex-col">
            <div className="h-28 bg-gradient-to-t from-ink to-transparent" />
            <div className="bg-ink px-4 pb-5 md:px-5 md:pb-6">
              <h1 className="poster text-[clamp(2.5rem,8.5vw,10rem)]">
                <span className="line-mask">
                  <span className="line-rise" style={{ "--d": "60ms" } as CSSProperties}>
                    Ten billion portfolios.
                  </span>
                </span>
                <span className="line-mask">
                  <span className="line-rise text-em" style={{ "--d": "170ms" } as CSSProperties}>
                    One measurement.
                  </span>
                </span>
              </h1>
              <div className="pointer-events-auto mt-5 grid items-end gap-x-8 gap-y-5 md:mt-6 xl:grid-cols-[auto_minmax(0,1fr)_auto]">
                <TransitionLink to="/terminal/optimise" className="soft-in fill-button group flex h-14 w-fit items-center gap-6 px-6 text-[15px] font-bold whitespace-nowrap" style={{ "--d": "420ms" } as CSSProperties}>
                  Open terminal
                  <ArrowRight size={18} weight="bold" className="nudge" />
                </TransitionLink>
                <p className="soft-in max-w-[46ch] text-[clamp(0.95rem,1.15vw,1.1rem)] leading-[1.4] text-dim" style={{ "--d": "520ms" } as CSSProperties}>
                  A hybrid quantum-classical engine that tests QAOA and amplitude estimation against classical solvers on real NIFTY 50 data.
                </p>
                <div className="soft-in flex flex-wrap items-center gap-x-5 gap-y-2" style={{ "--d": "620ms" } as CSSProperties}>
                  <div className="flex shadow-[inset_0_0_0_1px_var(--color-line-strong)]" role="group" aria-label="QAOA layers">
                    {Array.from({ length: LAST_LAYER + 1 }, (_, p) => (
                      <button
                        key={p}
                        onClick={() => jump(p)}
                        aria-pressed={layer === p}
                        aria-label={`Show ${p} QAOA layers`}
                        className={`mono-tight h-9 w-8 text-[12px] transition-colors duration-100 ${layer === p ? "bg-em text-ink" : layer > p ? "text-em" : "text-dim hover:text-text"}`}
                      >
                        {p}
                      </button>
                    ))}
                  </div>
                  <div className="min-w-[8.5rem]">
                    <div className="poster text-[30px] !leading-none text-gold tnum">
                      <Value value={pct(success, success < 0.01 ? 2 : 1)} />
                    </div>
                    <div className="mt-1 text-[11.5px] leading-tight text-dim">chance of the optimum at {layer} QAOA layers</div>
                  </div>
                  <button onClick={play} className="py-3 text-[13px] font-semibold text-text underline decoration-line-strong underline-offset-4 transition-colors hover:text-em">
                    Measure again
                  </button>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="stage-answer">
          <p className="answer-bits poster mono-tight text-[clamp(2.4rem,13.6vw,17rem)] !leading-[1] !tracking-[-0.03em] whitespace-nowrap text-gold tnum">{instance.optimum.join("")}</p>
          <div className="answer-meta mt-6 max-w-[62ch]">
            <p className="poster text-[clamp(1.1rem,2.5vw,2.5rem)] !leading-[1.05] !tracking-[-0.03em]">{held.join(", ")}</p>
            <p className="mt-4 text-[14px] leading-relaxed text-dim">
              The certified optimum of this instance, confirmed by exact branch and bound and by checking all {int(252)} valid portfolios. Prices to {date(instance.as_of)}.
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}

function Problem() {
  return (
    <section className="state-one relative overflow-hidden px-4 pt-14 pb-16 md:px-5 md:pt-20 md:pb-24">
      <Equation name="count" className="text-[clamp(1.1rem,1.8vw,1.8rem)]" />
      <p className="mono-tight mt-3 text-[clamp(2rem,11.6vw,15rem)] leading-[1.02] font-bold !tracking-[-0.055em] tnum">
        <Digits value="10,272,278,170" />
      </p>
      <Reveal className="mt-8 grid gap-6 md:mt-12 md:grid-cols-12">
        <p className="poster text-[clamp(1.7rem,4.4vw,5rem)] !leading-[0.98] md:col-span-8">That is how many ways you can pick 10 stocks out of the NIFTY 50.</p>
        <p className="max-w-[44ch] text-[17px] leading-snug font-medium md:col-span-4 md:pt-1">
          Lot sizes, budgets and holding limits turn a clean convex problem combinatorial. Classical solvers still handle it well. The open question is whether quantum methods can compete, and when.
        </p>
      </Reveal>
    </section>
  );
}

function QuboPanel() {
  const matrix = useMemo(() => withoutPenalty(instance.Q, instance.penalty, instance.K), []);
  return (
    <div>
      <HeatMatrix compress matrix={matrix} labels={instance.tickers} height={380} caption={(i, j, v) => `${instance.tickers[i]} x ${instance.tickers[j]}: ${num(v, 4)}`} />
      <p className="mx-auto max-w-[412px] px-4 text-[12.5px] leading-relaxed text-dim">The real matrix for ten NIFTY 50 stocks, shown without the penalty term so the risk and return structure is visible.</p>
    </div>
  );
}

function demoCircuit(): Drawing {
  // Depth-1 circuit on the first four assets of the real instance, in the layout of Figure 7.1.
  const gates: Gate[] = [];
  const frontier = [0, 0, 0, 0];
  const place = (name: string, qubits: number[]) => {
    const span = qubits.length > 1 ? [0, 1, 2, 3].filter((q) => q >= Math.min(...qubits) && q <= Math.max(...qubits)) : qubits;
    const column = Math.max(...span.map((q) => frontier[q]));
    span.forEach((q) => (frontier[q] = column + 1));
    gates.push({ name, qubits, column, param: null });
  };
  [0, 1, 2, 3].forEach((q) => place("h", [q]));
  [0, 1, 2, 3].forEach((q) => place("rz", [q]));
  for (let i = 0; i < 4; i += 1) for (let j = i + 1; j < 4; j += 1) place("rzz", [i, j]);
  [0, 1, 2, 3].forEach((q) => place("rx", [q]));
  [0, 1, 2, 3].forEach((q) => place("measure", [q]));
  return { qubits: 4, columns: Math.max(...frontier), gates };
}

function GrowBar({ width, className, delay }: { width: string; className: string; delay: number }) {
  return <span className={`bar-grow block h-full origin-left ${className}`} style={{ width, "--d": `${delay}ms` } as CSSProperties} />;
}

function SamplePanel() {
  const rows = useMemo(() => {
    const last = instance.schedules[instance.schedules.length - 1];
    return topStrings(qaoaProbabilities(last.gammas, last.betas), 9);
  }, []);
  const top = rows[0].probability;
  return (
    <ul className="mono-tight grid gap-2 text-[14px] tnum">
      {rows.map((row, index) => (
        <li key={row.index} className="grid grid-cols-[auto_1fr_auto] items-center gap-3.5">
          <span className={row.optimum ? "text-gold" : row.feasible ? "text-text" : "text-faint"}>{row.bits}</span>
          <span className="block h-4">
            <GrowBar width={`${(row.probability / top) * 100}%`} delay={index * 50} className={row.optimum ? "bg-gold" : row.feasible ? "bg-em" : "bg-white/25"} />
          </span>
          <span className="text-dim">{pct(row.probability, 1)}</span>
        </li>
      ))}
    </ul>
  );
}

function AssetsPanel() {
  const rows = instance.tickers.map((ticker, i) => ({ ticker, mu: instance.mu[i], vol: instance.vol[i] })).sort((a, b) => b.mu - a.mu);
  const widest = Math.max(...rows.map((r) => Math.abs(r.mu)));
  return (
    <div>
      <div className="mb-3 grid grid-cols-[minmax(0,8.5rem)_1fr_3.5rem] gap-3 text-[11.5px] text-dim">
        <span>Asset</span>
        <span>Expected return</span>
        <span className="text-right">Volatility</span>
      </div>
      <ul className="mono-tight grid gap-2 text-[13px] tnum">
        {rows.map((row, index) => (
          <li key={row.ticker} className="grid grid-cols-[minmax(0,8.5rem)_1fr_3.5rem] items-center gap-3">
            <span className="truncate text-text">{row.ticker}</span>
            <span className="flex items-center gap-2">
              <span className="block h-3" style={{ width: `${(Math.abs(row.mu) / widest) * 68}%` }}>
                <GrowBar width="100%" delay={index * 40} className={row.mu >= 0 ? "bg-em" : "bg-loss"} />
              </span>
              <span className="text-dim">{pct(row.mu, 0)}</span>
            </span>
            <span className="text-right text-dim">{pct(row.vol, 0)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function DecodePanel() {
  const held = instance.tickers.map((ticker, i) => ({ ticker, name: instance.names[i], on: instance.optimum[i] === 1 }));
  return (
    <div>
      <p className="mono-tight text-[clamp(1.7rem,3.8vw,3.4rem)] tracking-[0.06em] text-gold">
        <Digits value={instance.optimum.join("")} />
      </p>
      <ul className="mt-6 grid gap-x-6 gap-y-2.5 text-[15px] sm:grid-cols-2">
        {held
          .filter((h) => h.on)
          .map((h) => (
            <li key={h.ticker} className="flex items-baseline justify-between gap-4 border-b border-line pb-2">
              <span className="truncate">{h.name}</span>
              <span className="mono-tight text-[12px] text-dim tnum">{pct(1 / instance.K, 0)}</span>
            </li>
          ))}
      </ul>
    </div>
  );
}

const STAGES: { title: string; body: string; equation: EquationName; panel: () => ReactNode }[] = [
  {
    title: "Estimate",
    body: "Daily NIFTY 50 prices become expected returns and a shrinkage covariance. Each run records the exact data hash.",
    equation: "estimate",
    panel: () => <AssetsPanel />,
  },
  {
    title: "Encode",
    body: "One bit per asset. Risk, return and the holding limit fold into a single matrix, with a penalty calibrated per instance.",
    equation: "encode",
    panel: () => <QuboPanel />,
  },
  {
    title: "Prepare",
    body: "The matrix becomes a Hamiltonian, then a circuit. Dense covariance couples every pair of qubits, which is what makes hardware hard.",
    equation: "prepare",
    panel: () => <CircuitDiagram drawing={demoCircuit()} zoom={1.65} maxWidth={720} />,
  },
  {
    title: "Sample",
    body: "A classical optimiser tunes the angles until measurement concentrates on low-cost portfolios. These are this instance's most likely strings at p = 5.",
    equation: "sample",
    panel: () => <SamplePanel />,
  },
  {
    title: "Decode",
    body: "The best sampled string becomes a portfolio, repaired if infeasible, then scored against the classical ground truth.",
    equation: "decode",
    panel: () => <DecodePanel />,
  },
];

function Pipeline() {
  const [open, setOpen] = useState(0);
  return (
    <section id="how" className="scroll-mt-12 pt-14 md:pt-20">
      <Reveal className="px-4 pb-6 md:px-5 md:pb-8">
        <h2 className="max-w-[24ch] text-[clamp(1.2rem,1.9vw,1.8rem)] leading-tight font-semibold">From a price feed to a measured portfolio.</h2>
      </Reveal>
      <div className="border-b border-line">
        {STAGES.map((stage, index) => {
          const isOpen = open === index;
          return (
            <div key={stage.title} className="border-t border-line">
              <button aria-expanded={isOpen} onClick={() => setOpen(isOpen ? -1 : index)} className="stage-row flex w-full items-center justify-between gap-4 px-4 py-3 text-left md:px-5 md:py-4">
                <span className={`stage-word poster text-[clamp(2.8rem,12.6vw,16rem)] transition-colors duration-150 ${isOpen ? "text-em" : "text-text"}`}>{stage.title}</span>
                <Plus size={40} weight="bold" className={`stage-plus shrink-0 ${isOpen ? "text-em" : "text-dim"}`} />
              </button>
              {isOpen && (
                <div className="stat-enter grid items-start gap-8 px-4 pt-2 pb-10 md:px-5 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1fr)] lg:gap-16 lg:pb-14">
                  <div className="min-w-0">
                    <p className="max-w-[42ch] text-[clamp(1.1rem,1.5vw,1.35rem)] leading-snug">{stage.body}</p>
                    <Equation name={stage.equation} className="mt-7 max-w-full text-[17px] text-em" />
                  </div>
                  <div className="min-w-0">{stage.panel()}</div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

/** Every portfolio of the instance in one strip, ordered by energy. Real data as a graphic. */
function Spectrum() {
  const [ref, seen] = useSeen<HTMLDivElement>(0.2);
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const ranked = Array.from({ length: SIZE }, (_, i) => i).sort((a, b) => energies[a] - energies[b]);
    element.width = SIZE;
    element.height = 1;
    const context = element.getContext("2d")!;
    ranked.forEach((index, rank) => {
      context.fillStyle = feasible[index] ? COLORS.em : "rgb(255 255 255 / 0.06)";
      context.fillRect(rank, 0, 1, 1);
    });
    // Drawn last and wider than its one slot, or the single best portfolio would be invisible.
    context.fillStyle = COLORS.gold;
    context.fillRect(ranked.indexOf(optimumIndex), 0, 5, 1);
  }, [seen]);
  return (
    <div ref={ref}>
      <div className="relative h-[16vh] min-h-[90px]">
        {seen && (
          <div className="wipe-outer">
            <div className="wipe-inner">
              <canvas ref={canvas} aria-hidden className="block size-full [image-rendering:pixelated]" />
            </div>
          </div>
        )}
      </div>
      <p className="px-4 pt-2 text-[12.5px] leading-snug text-dim md:px-5">Every portfolio of this instance, ranked from lowest energy. Green strings are valid. The gold line is the optimum.</p>
    </div>
  );
}

function RangeRow({ label, value, min, max, step, onChange }: { label: string; value: number; min: number; max: number; step: number; onChange: (value: number) => void }) {
  const fill = ((value - min) / (max - min)) * 100;
  return (
    <label className="block">
      <span className="flex justify-between text-[13.5px] text-dim">
        <span>{label}</span>
        <span className="mono-tight text-[12.5px] text-text tnum">{num(value, 2)}</span>
      </span>
      <input type="range" className="range mt-1" style={{ "--fill": `${fill}%` } as CSSProperties} min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} />
    </label>
  );
}

function Playground() {
  const [gamma, setGamma] = useState(instance.schedules[0].gammas[0]);
  const [beta, setBeta] = useState(instance.schedules[0].betas[0]);
  const [schedule, setSchedule] = useState<number | null>(5);

  const probabilities = useMemo(() => {
    if (schedule !== null) {
      const s = instance.schedules[schedule - 1];
      return qaoaProbabilities(s.gammas, s.betas);
    }
    return qaoaProbabilities([gamma], [beta]);
  }, [gamma, beta, schedule]);
  const stats = useMemo(() => describe(probabilities), [probabilities]);
  const top = useMemo(() => topStrings(probabilities, 40), [probabilities]);
  const peak = top[0].probability;

  return (
    <section id="play" className="scroll-mt-12 pt-16 md:pt-24">
      <div className="grid gap-8 px-4 md:px-5 lg:grid-cols-12 lg:gap-10">
        <Reveal className="lg:col-span-4">
          <h2 className="poster text-[clamp(2.2rem,5vw,6rem)]">Turn the angles yourself.</h2>
          <p className="mt-5 max-w-[38ch] text-[16.5px] leading-snug text-dim">Ten real stocks. {int(SIZE)} amplitudes. This is the actual QAOA statevector, computed in your browser as you move the sliders.</p>
          <div className="mt-7 text-[13.5px] text-dim">Optimised angles at depth</div>
          <div className="mt-2 inline-flex shadow-[inset_0_0_0_1px_var(--color-line-strong)]" role="group" aria-label="Depth">
            {instance.schedules.map((s) => (
              <button key={s.p} onClick={() => setSchedule(s.p)} aria-pressed={schedule === s.p} className={`mono-tight size-11 text-[14px] transition-colors duration-100 ${schedule === s.p ? "bg-em text-ink" : "text-dim hover:text-text"}`}>
                {s.p}
              </button>
            ))}
          </div>
          <div className="mt-6 grid gap-3">
            <RangeRow
              label="Cost angle, one layer"
              value={gamma}
              min={0}
              max={instance.gamma_max}
              step={0.02}
              onChange={(value) => {
                setSchedule(null);
                setGamma(value);
              }}
            />
            <RangeRow
              label="Mixer angle, one layer"
              value={beta}
              min={0}
              max={Math.PI / 2}
              step={0.005}
              onChange={(value) => {
                setSchedule(null);
                setBeta(value);
              }}
            />
          </div>
        </Reveal>

        <dl className="min-w-0 lg:col-span-8">
          <div>
            <dt className="text-[13.5px] text-dim">P(optimum)</dt>
            <dd className="poster text-[clamp(4.6rem,19vw,24rem)] !leading-[0.95] text-gold tnum">
              <Value value={pct(stats.success, stats.success < 0.01 ? 2 : 1)} />
            </dd>
            <dd className="mt-1 text-[12.5px] text-faint">Uniform: {pct(1 / SIZE, 2)}</dd>
          </div>
          <div className="mt-6 grid grid-cols-2 gap-6 border-t border-line pt-4">
            <div>
              <dt className="text-[13.5px] text-dim">Feasible</dt>
              <dd className="mono-tight text-[clamp(1.8rem,4vw,4rem)] leading-tight font-medium !tracking-[-0.04em] text-em tnum">
                <Value value={pct(stats.feasibility, 0)} />
              </dd>
              <dd className="text-[12.5px] text-faint">Uniform: {pct(252 / SIZE, 0)}</dd>
            </div>
            <div>
              <dt className="text-[13.5px] text-dim">Solution quality</dt>
              <dd className="mono-tight text-[clamp(1.8rem,4vw,4rem)] leading-tight font-medium !tracking-[-0.04em] tnum">
                <Value value={num(stats.quality, 3)} />
              </dd>
              <dd className="text-[12.5px] text-faint">1 is the optimum</dd>
            </div>
          </div>
        </dl>
      </div>

      {/* Full bleed, edge to edge. Fixed slots ranked by probability, and only scaleY changes. */}
      <div className="mt-8 flex h-[32vh] min-h-[200px] items-end gap-px" role="img" aria-label="Probabilities of the forty most likely portfolios">
        {top.map((row, rank) => (
          <div key={rank} className={`bar-slot ${row.optimum ? "bg-gold" : row.feasible ? "bg-em" : "bg-white/20"}`} style={{ transform: `scaleY(${Math.max(row.probability / peak, 0.006)})` }} title={`${row.bits}: ${pct(row.probability, 2)}`} />
        ))}
      </div>
      <div className="border-t border-line px-4 py-3 md:px-5">
        <div className="flex flex-wrap gap-x-5 gap-y-1 text-[12.5px] text-dim">
          <span className="flex items-center gap-2"><span className="size-2.5 bg-gold" /> The true optimum, when it ranks in the top 40</span>
          <span className="flex items-center gap-2"><span className="size-2.5 bg-em" /> Valid: exactly {instance.K} assets</span>
          <span className="flex items-center gap-2"><span className="size-2.5 bg-white/20" /> Breaks the holding limit</span>
        </div>
        <p className="mt-2 max-w-[80ch] text-[12.5px] leading-relaxed text-faint">These angles are the best of several searches on this one instance, picked knowing its optimum, so they show what the circuit can reach. Benchmarks do not select this way, and their numbers are lower.</p>
      </div>
    </section>
  );
}

function Modules() {
  const { data } = useFetch<{ runs: RunHeader[] }>("/runs?kind=benchmark&status=finished&limit=1");
  const summary = data?.runs[0]?.summary as { baseline_agree?: string } | null | undefined;
  const rows = [
    { to: "/terminal/optimise", name: "Quantum portfolio optimisation", body: "QAOA on a calibrated QUBO, measured against exact MIQP, simulated annealing and brute force on the same instance and the same budget. The primary contribution.", figure: "p = 5" },
    { to: "/terminal/risk", name: "Quantum risk engine", body: "Iterative QAE for VaR and CVaR, with query counts kept apart from gate costs.", figure: "VaR, CVaR" },
    { to: "/terminal/markets", name: "Market data", body: "Fifty constituents, cleaned, hashed and versioned, with a quality report on every snapshot.", figure: instance.data_hash },
    { to: "/terminal/simulate", name: "Market simulation", body: "Correlated paths and stress regimes. In the crisis regime, volatility scales by 2.5 and correlations push toward one.", figure: "2.5x" },
    { to: "/terminal/benchmarks", name: "Benchmarking", body: "Matched budgets, walk-forward backtests and Wilcoxon tests. Every run stored with its seed and inputs.", figure: summary?.baseline_agree ?? "" },
  ];
  return (
    <section className="state-one mt-16 md:mt-24">
      <div className="px-4 pt-12 pb-8 md:px-5 md:pt-16 md:pb-10">
        <Reveal>
          <h2 className="poster text-[clamp(2.6rem,9.4vw,12rem)]">Five modules. One harness.</h2>
        </Reveal>
      </div>
      <div>
        {rows.map((row) => (
          <TransitionLink key={row.to} to={row.to} className="fill-row group grid items-baseline gap-x-8 gap-y-1 border-t border-line px-4 py-5 transition-colors duration-150 md:grid-cols-12 md:px-5 md:py-6">
            <span className="poster text-[clamp(1.5rem,3vw,3.4rem)] !leading-[1] md:col-span-6">{row.name}</span>
            <span className="max-w-[58ch] text-[15px] leading-snug md:col-span-4">{row.body}</span>
            <span className="mono-tight mt-1 flex min-w-0 items-center justify-between gap-3 text-[15px] [&>svg]:shrink-0 break-all font-medium tnum md:col-span-2 md:mt-0">
              {row.figure}
              <ArrowUpRight size={26} weight="bold" className="nudge shrink-0" />
            </span>
          </TransitionLink>
        ))}
      </div>
    </section>
  );
}

const STATEMENT = "We report it when quantum loses.".split(" ");

function Stance() {
  const [ref, seen] = useSeen<HTMLHeadingElement>(0.3);
  const { data } = useFetch<Run<BenchmarkResult>>("/runs/latest/benchmark");
  const rows = useMemo(() => {
    if (!data?.result) return [];
    const aggregate = data.result.aggregate;
    const sizes = Array.from(new Set(aggregate.map((r) => r.N))).sort((a, b) => a - b);
    const deepest = aggregate
      .filter((r) => r.solver.startsWith("QAOA") && !r.solver.includes("noise"))
      .map((r) => r.solver)
      .sort()
      .at(-1);
    return sizes.map((n) => ({
      n,
      ideal: aggregate.find((r) => r.N === n && r.solver === deepest),
      noisy: aggregate.find((r) => r.N === n && r.solver === `${deepest} + noise`),
      annealing: aggregate.find((r) => r.N === n && r.solver === "Simulated annealing"),
      label: deepest,
    }));
  }, [data]);

  return (
    <section className="px-4 py-16 md:px-5 md:py-28">
      <h2 ref={ref} className={`poster text-[clamp(3rem,12.6vw,17rem)] ${seen ? "is-in" : ""}`}>
        {STATEMENT.map((word, index) => (
          <span key={index} className={`word ${index >= 4 ? "text-em" : ""}`} style={{ "--i": index } as CSSProperties}>
            {word}
          </span>
        ))}
      </h2>
      <div className="mt-10 grid gap-10 md:mt-16 lg:grid-cols-12">
        <Reveal className="lg:col-span-4">
          <p className="max-w-[40ch] text-[clamp(1.1rem,1.5vw,1.35rem)] leading-snug">QANTUM makes no claim of quantum advantage. It measures where these algorithms compete, where they fall short and why, with negative results kept in the record.</p>
        </Reveal>
        {rows.length > 0 && (
          <Reveal className="min-w-0 lg:col-span-8">
            <div className="text-[13.5px] leading-snug text-dim">Chance that one {rows[0].label} measurement returns the true optimum, from the latest stored benchmark</div>
            <div className="mono-tight mt-5 grid grid-cols-[auto_1fr_1fr_1fr] items-baseline gap-x-5 border-b border-line text-[clamp(1.5rem,3.6vw,3.8rem)] !tracking-[-0.04em] tnum md:gap-x-8">
              <span className="pb-2 font-sans text-[12.5px] !tracking-normal [font-stretch:100%] text-faint">Assets</span>
              <span className="pb-2 font-sans text-[12.5px] !tracking-normal [font-stretch:100%] text-faint">Ideal</span>
              <span className="pb-2 font-sans text-[12.5px] !tracking-normal [font-stretch:100%] text-faint">With noise</span>
              <span className="pb-2 font-sans text-[12.5px] !tracking-normal [font-stretch:100%] text-faint">Annealing finds it</span>
              {rows.map((row) => (
                <div key={row.n} className="contents">
                  <span className="border-t border-line py-2 text-dim">{row.n}</span>
                  <span className="border-t border-line py-2 text-em">{pct(row.ideal?.success_probability?.median, 1)}</span>
                  <span className="border-t border-line py-2 text-gold">{row.noisy ? pct(row.noisy.success_probability?.median, 1) : <span className="font-sans text-[13px] !tracking-normal [font-stretch:100%] text-faint">not run</span>}</span>
                  <span className="border-t border-line py-2">{pct(row.annealing?.found_optimum_rate, 0)}</span>
                </div>
              ))}
            </div>
            <p className="mt-4 max-w-[80ch] text-[12.5px] leading-relaxed text-dim">Simulated on small instances, which are easy for classical solvers by construction. These numbers describe trends and do not show an advantage. The noise model is an assumption and describes no specific device.</p>
          </Reveal>
        )}
      </div>
    </section>
  );
}

function Closing() {
  return (
    <section className="state-one relative overflow-hidden">
      <div className="grid items-end gap-8 px-4 pt-12 pb-8 md:grid-cols-2 md:px-5 md:pt-16">
        <TransitionLink to="/team" className="group block">
          <span className="text-[14px] font-semibold">Made by</span>
          <span className="poster mt-3 block text-[clamp(2rem,6vw,7rem)] !leading-[0.96]">
            Jeh Dadina
            <br />
            Rishi Dadia
            <br />
            Shrish Alva
          </span>
        </TransitionLink>
        <TransitionLink to="/terminal/optimise" className="group flex h-16 items-center justify-between bg-ink px-6 text-[17px] font-bold text-em md:justify-self-end md:gap-16">
          Open terminal
          <ArrowRight size={22} weight="bold" className="nudge" />
        </TransitionLink>
      </div>
      <div aria-hidden className="poster pointer-events-none mt-2 translate-y-[8%] text-center text-[20.6vw] !leading-[0.78] whitespace-nowrap select-none">
        QANTUM
      </div>
    </section>
  );
}

export default function Landing() {
  return (
    <div className="overflow-x-clip">
      <Nav />
      <Stage />
      <Problem />
      <Pipeline />
      <div className="mt-14 md:mt-20">
        <Spectrum />
      </div>
      <Playground />
      <Modules />
      <Stance />
      <Closing />
    </div>
  );
}
