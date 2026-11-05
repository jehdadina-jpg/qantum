import { useEffect, useState } from "react";
import { BarsChart, COLORS, FanChart, seriesColor } from "../../components/charts";
import { Empty, ErrorNote, Field, PageHead, Panel, RunBar, RunButton, Segmented, Select, Skeleton, Slider, Stat, Td, Th } from "../../components/ui";
import type { SimulateResult } from "../../lib/api";
import { useExperiment } from "../../lib/hooks";
import { exp10, int, num, pct, signedPct } from "../../lib/format";

export default function Simulate() {
  const experiment = useExperiment<SimulateResult>("simulate");
  const [horizon, setHorizon] = useState(63);
  const [paths, setPaths] = useState(4000);
  const [model, setModel] = useState<"gbm" | "bootstrap">("gbm");
  const [regime, setRegime] = useState("baseline");
  const [portfolio, setPortfolio] = useState<string | null>(null);

  const busy = experiment.active !== null;
  const result = experiment.run?.status === "finished" ? experiment.run.result : null;
  const names = result ? Object.keys(result.portfolio_weights) : [];
  const chosen = portfolio && names.includes(portfolio) ? portfolio : names.find((n) => n.startsWith("QAOA")) ?? names[0];

  useEffect(() => setPortfolio(null), [experiment.run?.id]);

  const current = result?.regimes[regime]?.portfolios[chosen];

  return (
    <div>
      <PageHead title="Simulate">
        <span className="text-[12px] text-dim">Exploratory module. How the selected portfolios behave when markets change regime.</span>
      </PageHead>
      <RunBar run={experiment.run} runs={experiment.runs} active={experiment.active} onSelect={experiment.select} />

      <div className="grid gap-2 xl:grid-cols-[264px_minmax(0,1fr)]">
        <aside>
          <Panel title="Scenarios" className="xl:sticky xl:top-[60px]" bodyClassName="grid gap-3.5 px-4 pb-4 pt-1">
            <Field label="Horizon (sessions)" value={horizon}>
              <Slider value={horizon} onChange={setHorizon} min={5} max={252} />
            </Field>
            <Field label="Paths" value={int(paths)}>
              <Slider value={paths} onChange={setPaths} min={500} max={20000} step={500} />
            </Field>
            <Field label="Generator">
              <Select value={model} onChange={setModel} options={[{ value: "gbm", label: "Correlated GBM" }, { value: "bootstrap", label: "Historical block bootstrap" }]} />
            </Field>
            <p className="text-[11px] leading-snug text-faint">Portfolios come from the most recent optimisation. Stress regimes scale volatility and push correlations toward one.</p>
            {experiment.error && <ErrorNote>{experiment.error}</ErrorNote>}
            <RunButton onClick={() => experiment.submit({ horizon_days: horizon, paths, model })} busy={busy}>
              {busy ? "Running" : "Simulate"}
            </RunButton>
          </Panel>
        </aside>

        <div className="grid min-w-0 gap-3">
          {experiment.run?.status === "failed" && <ErrorNote>This run failed and its record was kept. {experiment.run.error?.split("\n")[0]}</ErrorNote>}
          {experiment.loading && <Skeleton className="h-[60vh]" />}
          {!experiment.loading && !result && !busy && (
            <Panel>
              <Empty title="No simulation stored yet">Run one on the left. It uses the portfolios from the latest optimisation.</Empty>
            </Panel>
          )}
          {result && current && (
            <>
              <div className="flex flex-wrap items-center gap-2 glass stat-enter p-2">
                <Segmented value={regime} onChange={setRegime} options={Object.entries(result.regimes).map(([key, value]) => ({ value: key, label: value.label }))} />
                <span className="ml-auto inline-block w-44">
                  <Select value={chosen} onChange={setPortfolio} options={names.map((n) => ({ value: n, label: n }))} />
                </span>
              </div>
              <div className="grid grid-cols-2 gap-x-6 gap-y-5 glass stat-enter px-4 py-4 md:grid-cols-3 xl:grid-cols-6">
                <Stat label="Median return" value={signedPct(current.median_return)} tone={current.median_return >= 0 ? "em" : "loss"} hint={`Over ${result.horizon_days} sessions`} />
                <Stat label="P(loss)" value={pct(current.probability_of_loss)} />
                <Stat label={`VaR ${pct(result.alpha, 0)}`} value={pct(current.var)} tone="gold" />
                <Stat label={`CVaR ${pct(result.alpha, 0)}`} value={pct(current.cvar)} />
                <Stat label="Mean max drawdown" value={pct(current.mean_max_drawdown)} />
                <Stat label="Drawdown, 99th pct" value={pct(current.worst_max_drawdown)} tone="loss" />
              </div>
              <div className="grid gap-2 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
                <Panel title="Value paths" aside={`${int(result.paths)} paths, ${result.model}`}>
                  <FanChart fan={current.fan} samples={current.samples} height={320} color={seriesColor(chosen)} />
                  <p className="px-3 pb-2 text-[11px] text-dim">Shaded bands are the 5 to 95 and 25 to 75 percentiles. The centre line is the median, and the dashed line is the starting value.</p>
                </Panel>
                <Panel title="Terminal return">
                  <BarsChart counts={current.terminal.counts} edges={current.terminal.edges} height={320} color={COLORS.em} xLabel="Return over the horizon" markers={[{ x: -current.var, label: "VaR", color: COLORS.gold }]} />
                </Panel>
              </div>
              <Panel title="Regime comparison" aside={chosen}>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr>
                        <Th align="left">Regime</Th>
                        <Th>Vol scale</Th>
                        <Th>Corr push</Th>
                        <Th>Median return</Th>
                        <Th>P(loss)</Th>
                        <Th>VaR</Th>
                        <Th>CVaR</Th>
                        <Th>Mean drawdown</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(result.regimes).map(([key, value]) => {
                        const row = value.portfolios[chosen];
                        return (
                          <tr key={key} onClick={() => setRegime(key)} className={`cursor-pointer border-t border-line transition-colors hover:bg-white/[0.04] ${key === regime ? "bg-white/[0.06]" : ""}`}>
                            <Td align="left">{value.label}</Td>
                            <Td>{num(value.parameters.vol_scale, 1)}</Td>
                            <Td>{num(value.parameters.corr_push, 1)}</Td>
                            <Td className={row.median_return >= 0 ? "text-em" : "text-loss"}>{signedPct(row.median_return)}</Td>
                            <Td>{pct(row.probability_of_loss)}</Td>
                            <Td>{pct(row.var)}</Td>
                            <Td>{pct(row.cvar)}</Td>
                            <Td>{pct(row.mean_max_drawdown)}</Td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </Panel>
              <div className="grid gap-2 xl:grid-cols-2">
                <Panel title="Portfolios under stress" aside={result.regimes[regime].label}>
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead>
                        <tr>
                          <Th align="left">Portfolio</Th>
                          <Th>Median</Th>
                          <Th>P(loss)</Th>
                          <Th>VaR</Th>
                          <Th>CVaR</Th>
                        </tr>
                      </thead>
                      <tbody>
                        {names.map((name) => {
                          const row = result.regimes[regime].portfolios[name];
                          return (
                            <tr key={name} className="border-t border-line">
                              <Td align="left">
                                <span className="flex items-center gap-2">
                                  <span className="size-2" style={{ background: seriesColor(name) }} />
                                  {name}
                                </span>
                              </Td>
                              <Td>{signedPct(row.median_return)}</Td>
                              <Td>{pct(row.probability_of_loss)}</Td>
                              <Td>{pct(row.var)}</Td>
                              <Td>{pct(row.cvar)}</Td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </Panel>
                {result.payoff && (
                  <Panel title="Expected payoff by QAE" aside={`${result.payoff.n_qubits} qubits`}>
                    <div className="grid grid-cols-2 gap-4 p-3">
                      <Stat label="Exact on the grid" value={num(result.payoff.exact_discrete, 5)} hint={`Call-style payoff, strike ${num(result.payoff.strike, 2)}, ${result.payoff.portfolio}`} />
                      <Stat label="Queries" value={int(result.payoff.qae_queries)} hint="Same count for both estimators" />
                      <Stat label="QAE error" value={exp10(result.payoff.qae_error)} tone="em" hint={`Estimate ${num(result.payoff.qae, 5)}`} />
                      <Stat label="Monte Carlo error" value={exp10(result.payoff.mc_error)} hint={`Median of 32 runs, estimate ${num(result.payoff.mc_median, 5)}`} />
                    </div>
                    <p className="border-t border-line px-3 py-2 text-[11px] text-dim">Ideal simulation of the circuit, so this measures query efficiency only. A single QAE run is one draw and the error can land either side of Monte Carlo.</p>
                  </Panel>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
