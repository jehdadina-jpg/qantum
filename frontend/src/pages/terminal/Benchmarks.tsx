import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { COLORS, Legend, LineChart, seriesColor } from "../../components/charts";
import { Check, Empty, ErrorNote, Field, NumberInput, PageHead, Panel, RunBar, RunButton, Segmented, Select, Skeleton, Slider, Stat, Td, Th } from "../../components/ui";
import type { BacktestResult, BenchmarkResult, BenchmarkRow, Summary } from "../../lib/api";
import { useExperiment } from "../../lib/hooks";
import { date, int, NA, num, pct, seconds, signedPct } from "../../lib/format";

type Metric = "gap" | "success_probability" | "approximation_ratio_feasible" | "feasibility_rate" | "runtime" | "oos_sharpe";

const METRICS: { value: Metric; label: string; axis: string; pct?: boolean; log?: boolean; solvers: "all" | "quantum" }[] = [
  { value: "success_probability", label: "P(optimum)", axis: "Median P(optimum)", pct: true, solvers: "quantum" },
  { value: "gap", label: "Optimality gap", axis: "Median gap to optimum", pct: true, solvers: "all" },
  { value: "approximation_ratio_feasible", label: "Approx. ratio", axis: "Median ratio over feasible", solvers: "quantum" },
  { value: "feasibility_rate", label: "Feasibility", axis: "Median feasibility rate", pct: true, solvers: "quantum" },
  { value: "runtime", label: "Wall-clock", axis: "Median seconds (classical emulation)", log: true, solvers: "all" },
  { value: "oos_sharpe", label: "Holdout Sharpe", axis: "Median Sharpe, out of sample", solvers: "all" },
];

const summaryOf = (row: BenchmarkRow, metric: Metric): Summary | null => row[metric];

const PRESETS = {
  quick: { sizes: [6, 8, 10, 12], depths: [1, 3, 5], instances: 5, initialisations: 2, maxiter: 150, seed_points: 256, include_noise: true },
  protocol: { sizes: [4, 6, 8, 10, 12, 14, 16], depths: [1, 2, 3, 4, 5], instances: 10, initialisations: 10, maxiter: 200, seed_points: 256, include_noise: true },
};

export default function Benchmarks() {
  const [params, setParams] = useSearchParams();
  const tab = params.get("view") === "walk-forward" ? "backtest" : "grid";
  const setTab = (next: "grid" | "backtest") => setParams(next === "backtest" ? { view: "walk-forward" } : {});
  return (
    <div>
      <PageHead title="Benchmarks">
        <Segmented value={tab} onChange={setTab} options={[{ value: "grid", label: "Benchmark grid" }, { value: "backtest", label: "Walk-forward" }]} />
      </PageHead>
      {tab === "grid" ? <GridView /> : <BacktestView />}
    </div>
  );
}

function GridView() {
  const experiment = useExperiment<BenchmarkResult>("benchmark");
  const [preset, setPreset] = useState<keyof typeof PRESETS>("quick");
  const [seed, setSeed] = useState(2026);
  const [metric, setMetric] = useState<Metric>("success_probability");
  const [noise, setNoise] = useState(true);
  const busy = experiment.active !== null;
  const result = experiment.run?.status === "finished" ? experiment.run.result : null;
  const definition = METRICS.find((m) => m.value === metric)!;

  const series = useMemo(() => {
    if (!result) return [];
    const groups = new Map<string, BenchmarkRow[]>();
    for (const row of result.aggregate) {
      if (definition.solvers === "quantum" && !row.solver.startsWith("QAOA")) continue;
      if (metric === "gap" && row.solver === "Exact MIQP") continue;
      groups.set(row.solver, [...(groups.get(row.solver) ?? []), row]);
    }
    return Array.from(groups, ([label, rows]) => {
      const usable = rows.filter((r) => summaryOf(r, metric)).sort((a, b) => a.N - b.N);
      const floor = (v: number) => (definition.log ? Math.max(v, 1e-5) : v);
      return {
        label,
        color: seriesColor(label),
        dots: true,
        dashed: label.includes("noise"),
        points: usable.map((r) => [r.N, floor(summaryOf(r, metric)!.median)] as [number, number]),
        band: usable.map((r) => [r.N, floor(summaryOf(r, metric)!.q1), floor(summaryOf(r, metric)!.q3)] as [number, number, number]),
      };
    }).filter((s) => s.points.length);
  }, [result, metric, definition]);

  const sizes = result ? Array.from(new Set(result.aggregate.map((r) => r.N))) : [];
  const [tableN, setTableN] = useState<number | null>(null);
  const shownN = tableN !== null && sizes.includes(tableN) ? tableN : sizes[sizes.length - 1];

  const evidence = result ? researchEvidence(result) : [];

  return (
    <>
      <RunBar run={experiment.run} runs={experiment.runs} active={experiment.active} onSelect={experiment.select} />
      <div className="grid gap-2 xl:grid-cols-[264px_minmax(0,1fr)]">
        <aside>
          <Panel title="Grid" className="xl:sticky xl:top-[60px]" bodyClassName="grid gap-3.5 px-4 pb-4 pt-1">
            <Field label="Configuration" hint={preset === "quick" ? "4 sizes, 3 depths, 5 instances, 2 starts. Minutes." : "The grid from section 11.1 of the proposal: 7 sizes, 5 depths, 10 instances, 10 starts. Expect hours."}>
              <Select value={preset} onChange={setPreset} options={[{ value: "quick", label: "Quick grid" }, { value: "protocol", label: "Full proposal protocol" }]} />
            </Field>
            <Field label="Seed">
              <NumberInput value={seed} onChange={setSeed} />
            </Field>
            <Check checked={noise} onChange={setNoise} label="Add noise-model runs, N up to 8" />
            {experiment.error && <ErrorNote>{experiment.error}</ErrorNote>}
            <RunButton onClick={() => experiment.submit({ ...PRESETS[preset], seed, include_noise: noise })} busy={busy}>
              {busy ? "Running" : "Run grid"}
            </RunButton>
          </Panel>
        </aside>
        <div className="grid min-w-0 gap-3">
          {experiment.run?.status === "failed" && <ErrorNote>This run failed and its record was kept. {experiment.run.error?.split("\n")[0]}</ErrorNote>}
          {experiment.loading && <Skeleton className="h-[60vh]" />}
          {!experiment.loading && !result && !busy && (
            <Panel>
              <Empty title="No benchmark stored yet">Run the quick grid to fill this workspace. Nothing here is assumed before it is measured.</Empty>
            </Panel>
          )}
          {!result && busy && (
            <Panel>
              <Empty title="Benchmark in progress">{experiment.active?.message ?? "Queued"}. Results appear here when the grid completes.</Empty>
            </Panel>
          )}
          {result && (
            <>
              <div className="grid grid-cols-2 gap-x-6 gap-y-5 glass stat-enter px-4 py-4 md:grid-cols-4">
                <Stat label="Records" value={int(result.records.length)} hint="One per solver, instance and start" />
                <Stat label="Baselines agree" value={`${result.baseline_agreement.agree} of ${result.baseline_agreement.checked}`} tone={result.baseline_agreement.agree === result.baseline_agreement.checked ? "em" : "loss"} hint="MIQP against brute force" />
                <Stat label="Matched budget" value={int(result.matched_budget_evals)} hint="Energy evaluations per instance" />
                <Stat label="Holdout" value={`${date(result.holdout_start).slice(3)} to ${date(result.holdout_end).slice(3)}`} hint="Never seen by any solver" />
              </div>

              <Panel title={definition.label} aside={<span className="inline-block w-44"><Select value={metric} onChange={setMetric} options={METRICS.map((m) => ({ value: m.value, label: m.label }))} /></span>}>
                <LineChart
                  height={330}
                  series={series}
                  xLabel="Assets N"
                  yLabel={definition.axis}
                  yLog={definition.log}
                  yFormat={definition.pct ? (v) => pct(v, v < 0.1 && v > 0 ? 1 : 0) : undefined}
                />
                <div className="border-t border-line px-3 py-2">
                  <Legend items={series.map((s) => ({ label: s.label, color: s.color, dashed: s.dashed }))} />
                  <p className="mt-1.5 text-[11px] text-dim">Lines are medians and shaded bands are interquartile ranges across instances and starts.</p>
                </div>
              </Panel>

              <Panel title="Results by solver" aside={<Segmented value={shownN} onChange={setTableN} options={sizes.map((s) => ({ value: s, label: `N ${s}` }))} />}>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr>
                        <Th align="left">Solver</Th>
                        <Th>Found optimum</Th>
                        <Th>Median gap</Th>
                        <Th>P(opt)</Th>
                        <Th>Feasible</Th>
                        <Th>Ratio</Th>
                        <Th>Holdout Sharpe</Th>
                        <Th>Time</Th>
                        <Th>Depth</Th>
                        <Th>Routed 2Q</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.aggregate
                        .filter((r) => r.N === shownN)
                        .map((row) => (
                          <tr key={`${row.solver}-${row.K}`} className="border-t border-line transition-colors hover:bg-white/[0.04]">
                            <Td align="left">
                              <span className="flex items-center gap-2">
                                <span className="size-2" style={{ background: seriesColor(row.solver) }} />
                                {row.solver}
                              </span>
                            </Td>
                            <Td>{pct(row.found_optimum_rate, 0)}</Td>
                            <Td>{pct(row.gap?.median, 2)}</Td>
                            <Td>{pct(row.success_probability?.median, 2)}</Td>
                            <Td>{pct(row.feasibility_rate?.median, 0)}</Td>
                            <Td>{num(row.approximation_ratio_feasible?.median, 3)}</Td>
                            <Td>{num(row.oos_sharpe?.median, 2)}</Td>
                            <Td>{seconds(row.runtime?.median)}</Td>
                            <Td>{row.depth ? int(row.depth.median) : NA}</Td>
                            <Td>{row.routed_two_qubit ? int(row.routed_two_qubit.median) : NA}</Td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </Panel>

              <Panel title="Paired tests" aside={`Wilcoxon signed-rank against ${result.paired_tests[0]?.baseline ?? "the baseline"}`}>
                {result.paired_tests.length === 0 ? (
                  <Empty title="Too few pairs">A test needs at least three instances per size.</Empty>
                ) : (
                  <div className="max-h-80 overflow-auto">
                    <table className="w-full">
                      <thead>
                        <tr>
                          <Th align="left">Solver</Th>
                          <Th>N</Th>
                          <Th align="left">Metric</Th>
                          <Th>Pairs</Th>
                          <Th>Median difference</Th>
                          <Th>p-value</Th>
                          <Th align="left">Outcome</Th>
                        </tr>
                      </thead>
                      <tbody>
                        {[...result.paired_tests].sort((a, b) => a.p_value - b.p_value).map((t) => (
                          <tr key={`${t.solver}-${t.N}-${t.metric}`} className="border-t border-line">
                            <Td align="left">{t.solver}</Td>
                            <Td>{t.N}</Td>
                            <Td align="left">{t.metric === "gap" ? "Gap" : "Holdout Sharpe"}</Td>
                            <Td>{t.pairs}</Td>
                            <Td>{t.metric === "gap" ? signedPct(t.median_difference, 2) : num(t.median_difference, 3)}</Td>
                            <Td>{t.p_value < 0.001 ? "below 0.001" : num(t.p_value, 3)}</Td>
                            <Td align="left" className={t.significant ? "text-gold" : "text-dim"}>{t.significant ? "Significant at 5%" : "Not significant"}</Td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <p className="border-t border-line px-3 py-2 text-[11px] text-dim">With few instances per size, the test cannot reach significance even when differences are real. Run the full protocol before drawing conclusions.</p>
              </Panel>

              <Panel title="Research questions" aside="evidence from this run">
                <div className="grid gap-px bg-line md:grid-cols-2">
                  {evidence.map((item) => (
                    <div key={item.id} className="bg-panel p-3">
                      <div className="mono-tight text-[11px] text-em">{item.id}</div>
                      <p className="mt-1 text-[13px] leading-snug font-medium">{item.question}</p>
                      <p className="mt-1.5 text-[12px] leading-relaxed text-dim">{item.evidence}</p>
                    </div>
                  ))}
                </div>
              </Panel>

              <div className="grid gap-1 px-1 text-[11px] text-dim">
                {result.notes.map((note) => (
                  <p key={note}>{note}</p>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}

function researchEvidence(result: BenchmarkResult) {
  const quantum = result.aggregate.filter((r) => r.solver.startsWith("QAOA") && !r.solver.includes("noise"));
  const sizes = Array.from(new Set(quantum.map((r) => r.N))).sort((a, b) => a - b);
  const largest = sizes[sizes.length - 1];
  const deepest = quantum.filter((r) => r.N === largest).sort((a, b) => b.solver.localeCompare(a.solver))[0];
  const smallestDeep = quantum.filter((r) => r.N === sizes[0]).sort((a, b) => b.solver.localeCompare(a.solver))[0];
  const annealing = result.aggregate.find((r) => r.solver === "Simulated annealing" && r.N === largest);
  const noisy = result.aggregate.filter((r) => r.solver.includes("noise"));
  const noisyTop = noisy[noisy.length - 1];
  const idealTwin = noisyTop ? result.aggregate.find((r) => r.N === noisyTop.N && r.K === noisyTop.K && r.solver === noisyTop.solver.replace(" + noise", "")) : undefined;
  const significant = result.paired_tests.filter((t) => t.significant).length;

  return [
    {
      id: "RQ1",
      question: "How effectively can QAOA solve constrained portfolio problems?",
      evidence: `${deepest?.solver} at N = ${largest}: decoded portfolio reached the optimum in ${pct(deepest?.found_optimum_rate, 0)} of runs, median gap ${pct(deepest?.gap?.median, 2)}, median P(optimum) ${pct(deepest?.success_probability?.median, 2)}.`,
    },
    {
      id: "RQ2",
      question: "How does it compare with classical optimisers?",
      evidence: `At N = ${largest}, annealing on the identical QUBO reached the optimum in ${pct(annealing?.found_optimum_rate, 0)} of runs at the matched budget. ${significant} of ${result.paired_tests.length} paired tests are significant at 5%.`,
    },
    {
      id: "RQ3",
      question: "What limits QAOA as portfolio size grows?",
      evidence: `${deepest?.solver}: depth ${int(deepest?.depth?.median)} and ${int(deepest?.routed_two_qubit?.median)} routed two-qubit gates at N = ${largest}. P(optimum) moves from ${pct(smallestDeep?.success_probability?.median, 1)} at N = ${sizes[0]} to ${pct(deepest?.success_probability?.median, 1)} at N = ${largest}.`,
    },
    {
      id: "RQ4",
      question: "Can amplitude estimation reduce estimation queries?",
      evidence: "Measured in the Risk workspace: error against queries for Iterative QAE and Monte Carlo at equal counts, with circuit cost reported apart from query count.",
    },
    {
      id: "RQ5",
      question: "How do depth, qubits and noise affect results?",
      evidence: noisyTop
        ? `${noisyTop.solver} at N = ${noisyTop.N}: median P(optimum) ${pct(noisyTop.success_probability?.median, 2)} against ${pct(idealTwin?.success_probability?.median, 2)} ideal, feasibility ${pct(noisyTop.feasibility_rate?.median, 0)} against ${pct(idealTwin?.feasibility_rate?.median, 0)}.`
        : "Add noise-model runs to this grid to measure it.",
    },
    {
      id: "RQ6",
      question: "Under what conditions, if any, could quantum methods offer an advantage?",
      evidence: "This grid covers small instances, which are easy for classical solvers by construction. It shows trends and cannot establish an advantage. The full protocol and hardware runs feed the final map.",
    },
  ];
}

function BacktestView() {
  const experiment = useExperiment<BacktestResult>("backtest");
  const [n, setN] = useState(10);
  const [k, setK] = useState(5);
  const [years, setYears] = useState(3);
  const [rebalance, setRebalance] = useState(21);
  const [bps, setBps] = useState(10);
  const [p, setP] = useState(2);
  const busy = experiment.active !== null;
  const result = experiment.run?.status === "finished" ? experiment.run.result : null;
  const names = result ? Object.keys(result.strategies) : [];
  const dates = result?.dates ?? [];
  const xFormat = (v: number) => (dates[Math.round(v)] ? date(dates[Math.round(v)]).slice(3) : "");
  const every = Math.max(Math.floor(dates.length / 300), 1);
  const thin = <T,>(values: T[]) => values.map((value, i) => [i, value] as [number, T]).filter(([i]) => i % every === 0 || i === values.length - 1);

  return (
    <>
      <RunBar run={experiment.run} runs={experiment.runs} active={experiment.active} onSelect={experiment.select} />
      <div className="grid gap-2 xl:grid-cols-[264px_minmax(0,1fr)]">
        <aside>
          <Panel title="Walk-forward" className="xl:sticky xl:top-[60px]" bodyClassName="grid gap-3.5 px-4 pb-4 pt-1">
            <Field label="Assets N" value={n}>
              <Slider value={n} onChange={setN} min={4} max={16} />
            </Field>
            <Field label="Cardinality K" value={Math.min(k, n)}>
              <Slider value={Math.min(k, n)} onChange={setK} min={1} max={n} />
            </Field>
            <Field label="Test length" value={`${years} years`}>
              <Slider value={years} onChange={setYears} min={1} max={4.5} step={0.5} />
            </Field>
            <Field label="Rebalance every" value={`${rebalance} sessions`}>
              <Slider value={rebalance} onChange={setRebalance} min={5} max={63} />
            </Field>
            <Field label="Transaction cost" value={`${bps} bps`}>
              <Slider value={bps} onChange={setBps} min={0} max={50} />
            </Field>
            <Field label="QAOA depth p" value={p}>
              <Slider value={p} onChange={setP} min={1} max={5} />
            </Field>
            {experiment.error && <ErrorNote>{experiment.error}</ErrorNote>}
            <RunButton onClick={() => experiment.submit({ n, K: Math.min(k, n), years, rebalance, transaction_bps: bps, p })} busy={busy}>
              {busy ? "Running" : "Run walk-forward"}
            </RunButton>
          </Panel>
        </aside>
        <div className="grid min-w-0 gap-3">
          {experiment.run?.status === "failed" && <ErrorNote>This run failed and its record was kept. {experiment.run.error?.split("\n")[0]}</ErrorNote>}
          {experiment.loading && <Skeleton className="h-[60vh]" />}
          {!experiment.loading && !result && !busy && (
            <Panel>
              <Empty title="No walk-forward stored yet">Run one to see out-of-sample value, drawdown and rolling Sharpe for every strategy.</Empty>
            </Panel>
          )}
          {!result && busy && (
            <Panel>
              <Empty title="Walk-forward in progress">{experiment.active?.message ?? "Queued"}.</Empty>
            </Panel>
          )}
          {result && (
            <>
              <Panel title="Net asset value" aside={`${date(result.dates[0])} to ${date(result.dates[result.dates.length - 1])}, ${result.rebalances} rebalances`}>
                <LineChart
                  height={340}
                  xFormat={xFormat}
                  yLabel="Value of 1 invested"
                  series={names.map((name) => ({
                    label: result.strategies[name].label,
                    color: seriesColor(result.strategies[name].label),
                    points: thin(result.strategies[name].nav),
                    width: result.strategies[name].label === "QAOA" ? 2 : 1.25,
                  }))}
                />
                <div className="border-t border-line px-3 py-2">
                  <Legend items={names.map((name) => ({ label: result.strategies[name].label, color: seriesColor(result.strategies[name].label) }))} />
                </div>
              </Panel>
              <div className="grid gap-2 xl:grid-cols-2">
                <Panel title="Drawdown">
                  <LineChart height={230} xFormat={xFormat} yFormat={(v) => pct(v, 0)} series={names.map((name) => ({ label: name, color: seriesColor(result.strategies[name].label), points: thin(result.strategies[name].drawdown), width: 1.25 }))} />
                </Panel>
                <Panel title="Rolling Sharpe" aside="63 sessions">
                  <LineChart
                    height={230}
                    xFormat={xFormat}
                    markers={[{ y: 0, color: COLORS.lineStrong }]}
                    series={names.map((name) => ({
                      label: name,
                      color: seriesColor(result.strategies[name].label),
                      points: thin(result.strategies[name].rolling_sharpe).filter(([, v]) => v !== null) as [number, number][],
                      width: 1.25,
                    }))}
                  />
                </Panel>
              </div>
              <Panel title="Out-of-sample performance" aside={`net of ${result.assumptions.transaction_bps} bps per unit of turnover`}>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr>
                        <Th align="left">Strategy</Th>
                        <Th>Total return</Th>
                        <Th>Annualised</Th>
                        <Th>Volatility</Th>
                        <Th>Sharpe</Th>
                        <Th>Max drawdown</Th>
                        <Th>Daily VaR 95</Th>
                        <Th>Daily CVaR 95</Th>
                        <Th>Turnover</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {names.map((name) => {
                        const { label, metrics, turnover } = result.strategies[name];
                        return (
                          <tr key={name} className="border-t border-line transition-colors hover:bg-white/[0.04]">
                            <Td align="left">
                              <span className="flex items-center gap-2">
                                <span className="size-2" style={{ background: seriesColor(label) }} />
                                {label}
                              </span>
                            </Td>
                            <Td>{signedPct(metrics.total_return, 1)}</Td>
                            <Td>{signedPct(metrics.return, 1)}</Td>
                            <Td>{pct(metrics.volatility)}</Td>
                            <Td>{num(metrics.sharpe)}</Td>
                            <Td>{pct(metrics.max_drawdown)}</Td>
                            <Td>{pct(metrics.var, 2)}</Td>
                            <Td>{pct(metrics.cvar, 2)}</Td>
                            <Td>{turnover === null || turnover === undefined ? NA : num(turnover, 1)}</Td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <p className="border-t border-line px-3 py-2 text-[11px] text-dim">
                  Universe: {result.tickers.join(", ")}. Risk-free rate {pct(result.assumptions.risk_free, 1)}, a flat assumption. {result.assumptions.survivorship} One path of one universe, so differences between strategies here are not evidence of a lasting edge.
                </p>
              </Panel>
            </>
          )}
        </div>
      </div>
    </>
  );
}
