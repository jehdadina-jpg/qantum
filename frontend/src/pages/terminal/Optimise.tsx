import { useMemo, useState } from "react";
import { BitstringBars, CircuitDiagram, COLORS, Donut, FrontierChart, HeatMatrix, LandscapeChart, Legend, LineChart, seriesColor, withoutPenalty } from "../../components/charts";
import { Check, Empty, ErrorNote, Field, Group, NumberInput, PageHead, Panel, RunBar, RunButton, Select, Skeleton, Slider, Stat, Td, Th } from "../../components/ui";
import type { Meta, OptimiseResult } from "../../lib/api";
import { useExperiment, useFetch } from "../../lib/hooks";
import { date, fidelity, int, NA, num, pct, seconds } from "../../lib/format";

type Mode = "statevector" | "shots" | "noise" | "mps" | "ibm";

export default function Optimise() {
  const experiment = useExperiment<OptimiseResult>("optimise");
  const { data: meta } = useFetch<Meta>("/meta");
  const [n, setN] = useState(10);
  const [k, setK] = useState(5);
  const [q, setQ] = useState(3);
  const [p, setP] = useState(5);
  const [universe, setUniverse] = useState<"top_weight" | "random">("top_weight");
  const [estimator, setEstimator] = useState<"ledoit_wolf" | "sample" | "ewma">("ledoit_wolf");
  const [mode, setMode] = useState<Mode>("statevector");
  const [objective, setObjective] = useState<"cvar" | "mean">("cvar");
  const [alpha, setAlpha] = useState(0.2);
  const [optimiser, setOptimiser] = useState<"COBYLA" | "SPSA">("COBYLA");
  const [mixer, setMixer] = useState<"x" | "xy">("x");
  const [shots, setShots] = useState(1024);
  const [maxiter, setMaxiter] = useState(300);
  const [restarts, setRestarts] = useState(4);
  const [seed, setSeed] = useState(11);
  const [compareNoise, setCompareNoise] = useState(true);
  const [allocation, setAllocation] = useState<string | null>(null);

  const cardinality = Math.min(k, n);
  const run = () =>
    experiment.submit({
      n,
      K: cardinality,
      q,
      universe,
      estimator,
      seed,
      compare_noise: compareNoise,
      qaoa: { p, mode, objective, alpha, optimiser, mixer, shots, maxiter, restarts },
    });

  const result = experiment.run?.status === "finished" ? experiment.run.result : null;
  const live = experiment.active?.partial;
  const busy = experiment.active !== null;

  const qaoaLabel = result?.portfolios.find((r) => r.label.startsWith("QAOA") && !r.label.includes("noise"))?.label ?? null;
  const allocationRow = result?.portfolios.find((r) => r.label === (allocation ?? qaoaLabel)) ?? result?.portfolios[0];

  const assets = useMemo(
    () => (result ? result.tickers.map((symbol, i) => ({ symbol, ret: result.estimates.mu[i], vol: result.estimates.vol[i] })) : []),
    [result],
  );

  const trace = live?.best?.length ? live : result ? { trace: result.qaoa.trace, best: result.qaoa.best_trace, evaluations: result.qaoa.objective_evaluations } : null;

  return (
    <div>
      <PageHead title="Optimise">
        <span className="text-[12px] text-dim">One instance. Every solver. The same budget.</span>
      </PageHead>
      <RunBar run={experiment.run} runs={experiment.runs} active={experiment.active} onSelect={experiment.select} />

      <div className="grid gap-2 xl:grid-cols-[264px_minmax(0,1fr)]">
        <aside>
          <Panel title="Experiment" className="xl:sticky xl:top-[60px]" bodyClassName="px-4 pb-4 xl:max-h-[calc(100dvh-120px)] xl:overflow-y-auto">
            <Group title="Problem">
              <Field label="Assets N" value={n}>
                <Slider label="Assets N" value={n} onChange={setN} min={2} max={mode === "mps" ? 50 : 20} />
              </Field>
              <Field label="Cardinality K" value={cardinality}>
                <Slider label="Cardinality K" value={cardinality} onChange={setK} min={1} max={n} />
              </Field>
              <Field label="Risk aversion q" value={num(q, 1)}>
                <Slider label="Risk aversion q" value={q} onChange={setQ} min={0.5} max={10} step={0.5} />
              </Field>
              <Field label="Universe">
                <Select value={universe} onChange={setUniverse} options={[{ value: "top_weight", label: "Largest by weight" }, { value: "random", label: "Random, from seed" }]} />
              </Field>
              <Field label="Covariance estimator">
                <Select value={estimator} onChange={setEstimator} options={[{ value: "ledoit_wolf", label: "Ledoit-Wolf shrinkage" }, { value: "sample", label: "Sample" }, { value: "ewma", label: "Exponentially weighted" }]} />
              </Field>
            </Group>
            <Group title="Circuit">
              <Field label="QAOA depth p" value={p}>
                <Slider label="QAOA depth p" value={p} onChange={setP} min={1} max={8} />
              </Field>
              <Field label="Execution mode">
                <Select
                  value={mode}
                  onChange={setMode}
                  options={(meta?.backends ?? [{ id: "statevector", label: "Exact statevector", available: true }]).map((b) => ({
                    value: b.id as Mode,
                    label: b.available ? b.label : `${b.label} (needs token)`,
                    disabled: !b.available,
                  }))}
                />
              </Field>
              <Field label="Mixer">
                <Select value={mixer} onChange={setMixer} options={[{ value: "x", label: "Transverse field" }, { value: "xy", label: "XY ring, keeps K fixed" }]} />
              </Field>
              <Check checked={compareNoise} onChange={setCompareNoise} label="Also sample on the noise model" />
            </Group>
            <Group title="Optimiser" defaultOpen={false}>
              <Field label="Objective">
                <Select value={objective} onChange={setObjective} options={[{ value: "cvar", label: "CVaR of energies" }, { value: "mean", label: "Mean energy" }]} />
              </Field>
              {objective === "cvar" && (
                <Field label="CVaR level" value={num(alpha, 2)}>
                  <Slider label="CVaR level" value={alpha} onChange={setAlpha} min={0.05} max={1} step={0.05} />
                </Field>
              )}
              <Field label="Classical optimiser">
                <Select value={optimiser} onChange={setOptimiser} options={[{ value: "COBYLA", label: "COBYLA" }, { value: "SPSA", label: "SPSA" }]} />
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Shots">
                  <NumberInput value={shots} onChange={setShots} min={16} max={100000} step={256} />
                </Field>
                <Field label="Iterations">
                  <NumberInput value={maxiter} onChange={setMaxiter} min={10} max={5000} step={10} />
                </Field>
                <Field label="Restarts">
                  <NumberInput value={restarts} onChange={setRestarts} min={1} max={20} />
                </Field>
                <Field label="Seed">
                  <NumberInput value={seed} onChange={setSeed} />
                </Field>
              </div>
            </Group>
            <div className="grid gap-2 pt-2">
              {mixer === "xy" && mode !== "statevector" && <p className="text-[11.5px] text-gold">The XY mixer runs on the exact statevector mode only.</p>}
              {experiment.error && <ErrorNote>{experiment.error}</ErrorNote>}
              <RunButton onClick={run} busy={busy} disabled={mixer === "xy" && mode !== "statevector"}>
                {busy ? "Running" : "Run experiment"}
              </RunButton>
            </div>
          </Panel>
        </aside>

        <div className="grid min-w-0 gap-3">
          {experiment.run?.status === "failed" && <ErrorNote>This run failed and its record was kept. {experiment.run.error?.split("\n")[0]}</ErrorNote>}
          {experiment.loading && <Skeleton className="h-[60vh]" />}
          {!experiment.loading && !result && !busy && experiment.run?.status !== "failed" && (
            <Panel>
              <Empty title="No optimisation stored yet">Set the experiment on the left and run it. The result and all its inputs are stored as a record.</Empty>
            </Panel>
          )}
          {!result && busy && (
            <Panel title="Convergence" aside={live ? `${int(live.evaluations)} evaluations` : "Waiting for the first evaluations"}>
              {live?.best?.length ? <LineChart height={280} series={[{ label: "Best", color: COLORS.em, points: live.best.map((v, i) => [i, v]) }]} xLabel="Objective evaluations" yLabel="Objective" /> : <Skeleton className="m-3 h-64" />}
            </Panel>
          )}

          {result && qaoaLabel && (
            <>
              <div className="grid grid-cols-2 gap-x-6 gap-y-5 glass stat-enter px-4 py-4 md:grid-cols-3 xl:grid-cols-6">
                <Stat label="Instance" value={`${result.instance.N} choose ${result.instance.K}`} hint={`${date(result.estimates.meta.start)} to ${date(result.estimates.meta.end)}`} />
                <Stat label="Gap to optimum" value={pct(result.portfolios.find((r) => r.label === qaoaLabel)?.gap, 2)} tone={(result.portfolios.find((r) => r.label === qaoaLabel)?.gap ?? 1) < 1e-9 ? "em" : "gold"} hint="Against the certified optimum" />
                <Stat label="P(optimum)" value={pct(result.qaoa.success_probability, 2)} tone="em" hint={`Uniform sampling: ${pct(1 / 2 ** result.instance.N, 2)}`} />
                <Stat label="Feasibility" value={pct(result.qaoa.feasibility_rate, 1)} hint="Share of probability on K assets" />
                <Stat label="Approx. ratio" value={num(result.qaoa.approximation_ratio_feasible, 3)} hint="Over feasible strings" />
                <Stat label="Penalty P" value={num(result.instance.penalty, 3)} hint={`Calibration: ${result.instance.calibration.method}`} />
              </div>

              <div className="grid gap-2 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
                <Panel title="Efficient frontier" aside={`${int(result.cloud.length)} equal-weight portfolios`}>
                  <FrontierChart
                    tickers={result.tickers}
                    height={330}
                    frontier={result.frontier}
                    cloud={result.cloud}
                    assets={assets}
                    portfolios={result.portfolios
                      .filter((r) => r.bits && r.label !== "Brute force")
                      .map((r) => ({ label: r.label, ret: r.expected_return, vol: r.volatility, tickers: r.tickers, color: seriesColor(r.label) }))}
                  />
                  <div className="border-t border-line px-3 py-2">
                    <Legend
                      items={[
                        { label: "Continuous frontier", color: COLORS.text },
                        ...result.portfolios.filter((r) => r.bits && r.label !== "Brute force").map((r) => ({ label: r.label, color: seriesColor(r.label) })),
                      ]}
                    />
                    <p className="mt-1.5 text-[11px] text-dim">Dots are binary candidates, coloured from worst objective to best. Squares are single assets. Binary portfolios sit on or inside the frontier by construction.</p>
                  </div>
                </Panel>
                <Panel
                  title="Allocation"
                  aside={
                    <span className="inline-block w-40">
                      <Select value={allocationRow?.label ?? ""} onChange={setAllocation} options={result.portfolios.map((r) => ({ value: r.label, label: r.label }))} />
                    </span>
                  }
                >
                  {allocationRow && (
                    <div className="p-4">
                      <Donut weights={allocationRow.weights} centre={String(allocationRow.tickers.length)} caption="assets" />
                      <dl className="mt-5 grid grid-cols-2 gap-x-5 gap-y-2.5 text-[12.5px] sm:grid-cols-3">
                        <Metric label="Expected return" value={pct(allocationRow.expected_return)} />
                        <Metric label="Volatility" value={pct(allocationRow.volatility)} />
                        <Metric label="Sharpe" value={num(allocationRow.sharpe)} />
                        <Metric label="Max drawdown" value={pct(allocationRow.in_sample.max_drawdown)} />
                        <Metric label="Daily VaR 95" value={pct(allocationRow.in_sample.var, 2)} />
                        <Metric label="Daily CVaR 95" value={pct(allocationRow.in_sample.cvar, 2)} />
                      </dl>
                      <p className="mt-3 text-[11px] text-dim">Estimated on the same window as the optimiser, so this is in-sample. Out-of-sample results are under Benchmarks.</p>
                    </div>
                  )}
                </Panel>
              </div>

              <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3 md:[&>*:last-child]:col-span-2 xl:[&>*:last-child]:col-span-1">
                <Panel title="Convergence" aside={trace ? `${int(trace.evaluations)} evaluations` : undefined}>
                  {trace && (
                    <LineChart
                      height={262}
                      series={[
                        { label: "Evaluated", color: COLORS.lineStrong, points: trace.trace.map((v, i) => [i, v]), width: 1 },
                        { label: "Best so far", color: COLORS.em, points: trace.best.map((v, i) => [i, v]), width: 1.75, fill: true },
                      ]}
                      markers={result.qaoa.seed_evaluations ? [{ x: result.qaoa.seed_evaluations, label: "refine", color: COLORS.gold }] : undefined}
                      xLabel="Objective evaluations"
                      yLabel={result.qaoa.objective_kind === "cvar" ? `CVaR ${num(result.qaoa.alpha, 2)}` : "Mean energy"}
                    />
                  )}
                  <p className="px-3 pb-2 text-[11px] text-dim">Quasi-random search over the angle box, then layer-wise refinement with {result.qaoa.optimiser}.</p>
                </Panel>
                <Panel title="Measured strings" aside={`p = ${result.qaoa.p}, ${result.qaoa.mode}`}>
                  <BitstringBars rows={result.qaoa.histogram} tickers={result.tickers} height={262} />
                </Panel>
                <Panel title="Energy landscape" aside="exact, p = 1">
                  {result.qaoa.landscape ? (
                    <>
                      <LandscapeChart landscape={result.qaoa.landscape} height={262} />
                      <p className="px-3 pb-2 text-[11px] text-dim">Lighter means lower expected energy. The ring marks the grid minimum, the cross marks the best search seed.</p>
                    </>
                  ) : (
                    <Empty title="Landscape not computed">Exact landscapes are computed for N up to 14 on the transverse-field mixer.</Empty>
                  )}
                </Panel>
              </div>

              <Panel title="Classical vs quantum" aside={`same instance, ${int(result.matched_budget_evals)} energy evaluations for annealing and QAOA`}>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr>
                        <Th align="left">Method</Th>
                        <Th>Objective</Th>
                        <Th>Gap</Th>
                        <Th>Return</Th>
                        <Th>Vol</Th>
                        <Th>Sharpe</Th>
                        <Th>P(opt)</Th>
                        <Th>Feasible</Th>
                        <Th>Time</Th>
                        <Th>Qubits</Th>
                        <Th>Depth</Th>
                        <Th>2Q gates</Th>
                        <Th>Heavy-hex 2Q</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.portfolios.map((row) => (
                        <tr key={row.label} className="border-t border-line transition-colors hover:bg-white/[0.04]">
                          <Td align="left">
                            <span className="flex items-center gap-2">
                              <span className="size-2 shrink-0" style={{ background: seriesColor(row.label) }} />
                              {row.label}
                              {row.certified && <span className="text-[11px] text-em">certified</span>}
                            </span>
                          </Td>
                          <Td>{row.objective === null ? NA : num(row.objective, 4)}</Td>
                          <Td className={row.gap !== null && row.gap > 1e-9 ? "text-gold" : "text-em"}>{row.gap === null ? "ref" : pct(row.gap, 2)}</Td>
                          <Td>{pct(row.expected_return)}</Td>
                          <Td>{pct(row.volatility)}</Td>
                          <Td>{num(row.sharpe)}</Td>
                          <Td>{pct(row.success_probability, 2)}</Td>
                          <Td>{pct(row.feasibility_rate, 1)}</Td>
                          <Td>{seconds(row.runtime)}</Td>
                          <Td>{row.qubits ?? NA}</Td>
                          <Td>{row.depth ?? NA}</Td>
                          <Td>{row.two_qubit ?? NA}</Td>
                          <Td>{row.routed_two_qubit ?? NA}</Td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="border-t border-line px-3 py-2 text-[11px] text-dim">
                  Time for QAOA is the cost of emulating it on this computer and says nothing about quantum hardware. {result.noisy_qaoa && `Noise row: parameters trained ideally, then sampled with gate errors of ${result.noisy_qaoa.noise.p2} (2Q), ${result.noisy_qaoa.noise.p1} (1Q) and readout ${result.noisy_qaoa.noise.readout}, an assumed model of no specific device.`}
                </p>
              </Panel>

              <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3 md:[&>*:last-child]:col-span-2 xl:[&>*:last-child]:col-span-1">
                <Panel title="QUBO matrix" aside={`penalty P = ${num(result.instance.penalty, 3)} removed for display`}>
                  <HeatMatrix compress matrix={withoutPenalty(result.qubo.Q, result.instance.penalty, result.instance.K)} labels={result.tickers} height={270} caption={(i, j, v) => `${result.tickers[i]} x ${result.tickers[j]}: ${num(v, 4)}`} />
                </Panel>
                <Panel title="Correlation" aside={result.estimates.meta.shrinkage !== null ? `shrinkage ${num(result.estimates.meta.shrinkage, 3)}` : result.estimates.meta.estimator}>
                  <HeatMatrix matrix={result.estimates.corr} labels={result.tickers} height={270} caption={(i, j, v) => `${result.tickers[i]} x ${result.tickers[j]}: ${num(v, 2)}`} />
                </Panel>
                <Panel title="Circuit" aside={result.qaoa.resources ? `${result.qaoa.resources.qubits} qubits, depth ${result.qaoa.resources.all_to_all.depth}` : undefined}>
                  <div className="p-3">
                    {result.qaoa.resources && (
                      <div className="grid grid-cols-2 gap-4">
                        <Stat label="All-to-all 2Q" value={int(result.qaoa.resources.all_to_all.two_qubit_gates)} hint={`Est. fidelity ${fidelity(result.qaoa.resources.all_to_all.esp)}`} />
                        <Stat label="Heavy-hex 2Q" value={int(result.qaoa.resources.heavy_hex.two_qubit_gates)} tone="gold" hint={`Est. fidelity ${fidelity(result.qaoa.resources.heavy_hex.esp)}`} />
                      </div>
                    )}
                    {result.qaoa.gates ? (
                      <div className="mt-4">
                        <div className="label mb-2">One layer</div>
                        <CircuitDiagram drawing={result.qaoa.gates} />
                      </div>
                    ) : (
                      <p className="mt-4 text-[12px] text-dim">Dense covariance couples every pair of qubits, so N = {result.instance.N} needs {int((result.instance.N * (result.instance.N - 1)) / 2)} RZZ rotations per layer. The Circuits workspace draws any size.</p>
                    )}
                  </div>
                </Panel>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] text-dim">{label}</dt>
      <dd className="mono-tight mt-0.5 text-[12.5px] tnum">{value}</dd>
    </div>
  );
}
