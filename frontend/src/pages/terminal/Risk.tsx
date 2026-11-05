import { useState } from "react";
import { COLORS, Legend, LineChart, LossHistogram } from "../../components/charts";
import { Check, Empty, ErrorNote, Field, PageHead, Panel, RunBar, RunButton, Skeleton, Slider, Stat, Td, Th } from "../../components/ui";
import type { RiskResult } from "../../lib/api";
import { useExperiment } from "../../lib/hooks";
import { exp10, int, num, pct } from "../../lib/format";

export default function Risk() {
  const experiment = useExperiment<RiskResult>("risk");
  const [alpha, setAlpha] = useState(0.95);
  const [horizon, setHorizon] = useState(1);
  const [qubits, setQubits] = useState(5);
  const [epsilon, setEpsilon] = useState(-2.3);
  const [noise, setNoise] = useState(true);

  const busy = experiment.active !== null;
  const result = experiment.run?.status === "finished" ? experiment.run.result : null;

  const run = () =>
    experiment.submit({ alpha, horizon_days: horizon, n_qubits: qubits, epsilon: 10 ** epsilon, include_noise: noise });

  return (
    <div>
      <PageHead title="Risk">
        <span className="text-[12px] text-dim">Exploratory module. Query counts, gate costs and noisy accuracy are separate quantities.</span>
      </PageHead>
      <RunBar run={experiment.run} runs={experiment.runs} active={experiment.active} onSelect={experiment.select} />

      <div className="grid gap-2 xl:grid-cols-[264px_minmax(0,1fr)]">
        <aside>
          <Panel title="Estimation" className="xl:sticky xl:top-[60px]" bodyClassName="grid gap-3.5 px-4 pb-4 pt-1">
            <Field label="Confidence level" value={pct(alpha, 0)}>
              <Slider value={alpha} onChange={setAlpha} min={0.9} max={0.99} step={0.01} />
            </Field>
            <Field label="Horizon (sessions)" value={horizon}>
              <Slider value={horizon} onChange={setHorizon} min={1} max={21} />
            </Field>
            <Field label="Uncertainty qubits" value={`${qubits}, ${2 ** qubits} bins`}>
              <Slider value={qubits} onChange={setQubits} min={3} max={7} />
            </Field>
            <Field label="Target error" value={exp10(10 ** epsilon)}>
              <Slider value={epsilon} onChange={setEpsilon} min={-3.5} max={-1.5} step={0.1} />
            </Field>
            <Check checked={noise} onChange={setNoise} label="Include the noise study on Aer" />
            <p className="text-[11px] leading-snug text-faint">The portfolio is the QAOA pick of the most recent optimisation.</p>
            {experiment.error && <ErrorNote>{experiment.error}</ErrorNote>}
            <RunButton onClick={run} busy={busy}>
              {busy ? "Running" : "Estimate risk"}
            </RunButton>
          </Panel>
        </aside>

        <div className="grid min-w-0 gap-3">
          {experiment.run?.status === "failed" && <ErrorNote>This run failed and its record was kept. {experiment.run.error?.split("\n")[0]}</ErrorNote>}
          {experiment.loading && <Skeleton className="h-[60vh]" />}
          {!experiment.loading && !result && !busy && (
            <Panel>
              <Empty title="No risk estimate stored yet">Run an optimisation first so there is a portfolio to analyse, or run this now to use an equal-weight portfolio.</Empty>
            </Panel>
          )}
          {result && <RiskView result={result} />}
        </div>
      </div>
    </div>
  );
}

function RiskView({ result }: { result: RiskResult }) {
  const rows = result.scaling.rows;
  const noisy = result.noise_study;
  const level = pct(result.alpha, 0);
  return (
    <>
      <div className="grid grid-cols-2 gap-x-6 gap-y-5 glass stat-enter px-4 py-4 md:grid-cols-3 xl:grid-cols-6">
        <Stat label={`VaR ${level}`} value={pct(result.exact_discrete.var, 2)} tone="gold" hint={`${result.horizon_days}-session loss, exact on the grid`} />
        <Stat label={`CVaR ${level}`} value={pct(result.exact_discrete.cvar, 2)} hint="Mean loss beyond VaR" />
        <Stat label="QAE queries" value={int(result.qae.queries)} hint="Oracle calls, including bisection" />
        <Stat label="QAE slope" value={num(result.scaling.qae_slope, 2)} tone="em" hint="Error vs queries. Theory: -1" />
        <Stat label="MC slope" value={num(result.scaling.mc_slope, 2)} hint="Error vs samples. Theory: -0.5" />
        <Stat label="Portfolio" value={result.portfolio.label} hint={`${Object.keys(result.portfolio.weights).length} holdings`} />
      </div>

      <div className="grid gap-2 xl:grid-cols-2">
        <Panel title="Loss distribution" aside={`${int(result.scenarios)} scenarios on ${2 ** result.n_qubits} bins`}>
          <LossHistogram grid={result.histogram.grid} probabilities={result.histogram.probabilities} var={result.exact_discrete.var} cvar={result.exact_discrete.cvar} height={290} />
          <p className="px-3 pb-2 text-[11px] text-dim">Bars right of VaR are the tail both estimators must find. Correlated log-normal scenarios from the shrinkage covariance.</p>
        </Panel>
        <Panel title="Error against queries" aside={`median of ${result.scaling.repeats} repeats`}>
          <LineChart
            height={290}
            xLog
            yLog
            xLabel="Oracle queries, or Monte Carlo samples"
            yLabel="Absolute error"
            series={[
              { label: "Monte Carlo", color: COLORS.sky, points: rows.map((r) => [r.queries, Math.max(r.mc_error, 1e-7)]), dots: true, band: rows.map((r) => [r.queries, Math.max(r.mc_q1, 1e-7), Math.max(r.mc_q3, 1e-7)]) },
              { label: "Iterative QAE", color: COLORS.em, points: rows.map((r) => [r.queries, Math.max(r.qae_error, 1e-7)]), dots: true, band: rows.map((r) => [r.queries, Math.max(r.qae_q1, 1e-7), Math.max(r.qae_q3, 1e-7)]) },
            ]}
          />
          <div className="px-3 pb-2">
            <Legend items={[{ label: "Iterative QAE, ideal circuit", color: COLORS.em }, { label: "Monte Carlo at the same count", color: COLORS.sky }]} />
          </div>
        </Panel>
      </div>

      <Panel title="Estimates at matched budget" aside={`${int(result.qae.queries)} queries each`}>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr>
                <Th align="left">Estimator</Th>
                <Th>VaR</Th>
                <Th>VaR error</Th>
                <Th>CVaR</Th>
                <Th>CVaR error</Th>
                <Th>Queries or samples</Th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-t border-line">
                <Td align="left">Exact, on the grid</Td>
                <Td>{pct(result.exact_discrete.var, 3)}</Td>
                <Td>ref</Td>
                <Td>{pct(result.exact_discrete.cvar, 3)}</Td>
                <Td>ref</Td>
                <Td>n/a</Td>
              </tr>
              <tr className="border-t border-line">
                <Td align="left">Iterative QAE, ideal</Td>
                <Td>{pct(result.qae.var, 3)}</Td>
                <Td>{pct(result.qae.var_error, 3)}</Td>
                <Td>{pct(result.qae.cvar, 3)}</Td>
                <Td>{pct(result.qae.cvar_error, 3)}</Td>
                <Td>{int(result.qae.queries)}</Td>
              </tr>
              <tr className="border-t border-line">
                <Td align="left">Monte Carlo, median of {result.monte_carlo.repeats}</Td>
                <Td>{pct(result.monte_carlo.var, 3)}</Td>
                <Td>{pct(result.monte_carlo.var_error, 3)}</Td>
                <Td>{pct(result.monte_carlo.cvar, 3)}</Td>
                <Td>{pct(result.monte_carlo.cvar_error, 3)}</Td>
                <Td>{int(result.monte_carlo.queries)}</Td>
              </tr>
              <tr className="border-t border-line">
                <Td align="left">Before discretising</Td>
                <Td>{pct(result.continuous.var, 3)}</Td>
                <Td>{pct(result.discretisation_error.var, 3)}</Td>
                <Td>{pct(result.continuous.cvar, 3)}</Td>
                <Td>{pct(result.discretisation_error.cvar, 3)}</Td>
                <Td>{int(result.scenarios)}</Td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="border-t border-line px-3 py-2 text-[11px] text-dim">The last row shows how far the grid itself moves the answer. VaR is restricted to grid points, so a VaR error of zero means the right bin was found.</p>
      </Panel>

      <div className="grid gap-2 xl:grid-cols-2">
        <Panel title="Theory versus practice" aside={`${result.circuit_cost.qubits} qubits`}>
          <div className="grid grid-cols-2 gap-4 border-b border-line p-3 sm:grid-cols-4">
            <Stat label="One oracle A" value={int(result.circuit_cost.a.two_qubit)} hint="2Q gates, loading plus payoff" />
            <Stat label="A depth" value={int(result.circuit_cost.a.depth)} />
            <Stat label="One Grover Q" value={int(result.circuit_cost.q.two_qubit)} tone="gold" hint="2Q gates per power" />
            <Stat label="Q depth" value={int(result.circuit_cost.q.depth)} />
          </div>
          <LineChart
            height={230}
            xLabel="Grover power k"
            yLabel="2Q gates"
            series={[{ label: "2Q gates", color: COLORS.gold, points: result.circuit_cost.powers.map((r) => [r.k, r.two_qubit]), dots: true }]}
          />
          <p className="px-3 pb-2 text-[11px] text-dim">
            Reaching the {exp10(rows[rows.length - 1].epsilon)} error target used Grover powers up to {rows[rows.length - 1].max_power}. Each power adds the full Q circuit, and noise accumulates fastest there.
          </p>
        </Panel>
        <Panel title="What noise does to it" aside={noisy ? `${noisy.n_qubits} qubits, Aer` : undefined}>
          {noisy ? (
            <>
              <LineChart
                height={230}
                xLabel="Grover power k"
                yLabel="P(objective = 1)"
                yDomain={[0, 1]}
                series={[
                  { label: "Ideal", color: COLORS.em, points: noisy.rows.map((r) => [r.k, r.ideal]), dots: true },
                  { label: "Noise model", color: COLORS.gold, points: noisy.rows.map((r) => [r.k, r.noisy]), dots: true, dashed: true },
                ]}
              />
              <div className="px-3 pb-2">
                <Legend items={[{ label: "Ideal", color: COLORS.em }, { label: "Noise model", color: COLORS.gold, dashed: true }]} />
              </div>
              <div className="grid grid-cols-2 gap-4 border-t border-line p-3">
                <Stat label="IQAE error, ideal" value={exp10(noisy.ideal_iqae.error)} tone="em" hint={`${int(noisy.ideal_iqae.queries)} queries, powers up to ${noisy.ideal_iqae.max_power}`} />
                <Stat label="IQAE error, noisy" value={exp10(noisy.noisy_iqae.error)} tone="gold" hint={`${int(noisy.noisy_iqae.queries)} queries${noisy.noisy_iqae.stalled ? ", intervals became inconsistent" : ""}`} />
              </div>
            </>
          ) : (
            <Empty title="Noise study skipped">Enable it on the left to run real A Q^k circuits on Aer with gate and readout errors.</Empty>
          )}
        </Panel>
      </div>
    </>
  );
}
