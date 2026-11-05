// Typed client for the FastAPI service. Field names match backend/qantum/jobs.py.

export type RunKind = "optimise" | "risk" | "simulate" | "benchmark" | "backtest" | "refresh";
export type RunStatus = "queued" | "running" | "finished" | "failed" | "interrupted";

export interface RunHeader {
  id: string;
  kind: RunKind;
  status: RunStatus;
  title: string;
  created_at: string | null;
  finished_at: string | null;
  spec: Record<string, unknown>;
  summary: Record<string, unknown> | null;
  error: string | null;
  data_hash: string | null;
  versions: Record<string, string> | null;
  progress?: number;
  message?: string;
}

export interface Run<T = unknown> extends RunHeader {
  result: T | null;
  partial?: { trace: number[]; best: number[]; evaluations: number } | null;
}

export interface Meta {
  version: string;
  read_only: boolean;
  snapshot: { id: string; fetched_at: string; start: string; end: string; sessions: number; sha256: string; source: string; excluded: string[] };
  symbols: number;
  risk_free: number;
  max_exact_qubits: number;
  versions: Record<string, string>;
  backends: { id: string; label: string; available: boolean }[];
  regimes: Record<string, { label: string; vol_scale: number; corr_push: number; drift_shift: number }>;
}

export interface Tile {
  symbol: string;
  name: string;
  industry: string;
  last: number;
  returns: Record<string, number | null>;
  weight: number | null;
  market_cap: number | null;
  spark: number[];
}

export interface Overview {
  as_of: string;
  fetched_at: string;
  index: { symbol: string; last: number; returns: Record<string, number>; history: { date: string; value: number }[] };
  weight_note: string;
  tiles: Tile[];
}

export interface Quality {
  snapshot: string;
  sha256: string;
  source: string;
  sessions: number;
  start: string;
  end: string;
  excluded: string[];
  rows: { symbol: string; name: string; first_date: string; observations: number; missing: number; filled: number; stale_runs: number; outliers: number }[];
}

export interface PortfolioRow {
  label: string;
  solver: string;
  bits: string | null;
  tickers: string[];
  weights: Record<string, number>;
  objective: number | null;
  gap: number | null;
  certified: boolean;
  expected_return: number;
  volatility: number;
  sharpe: number | null;
  in_sample: { return: number; volatility: number; sharpe: number | null; max_drawdown: number; var: number; cvar: number; total_return: number };
  runtime: number;
  evaluations: number;
  qubits: number | null;
  depth: number | null;
  two_qubit: number | null;
  routed_depth: number | null;
  routed_two_qubit: number | null;
  feasibility_rate: number | null;
  success_probability: number | null;
  approximation_ratio: number | null;
  approximation_ratio_feasible: number | null;
  mode: string | null;
}

export interface Resources {
  qubits: number;
  logical_two_qubit: number;
  all_to_all: CircuitCounts;
  heavy_hex: CircuitCounts;
  noise_assumed: { p1: number; p2: number; readout: number };
}

export interface CircuitCounts {
  depth: number;
  two_qubit_depth: number;
  two_qubit_gates: number;
  one_qubit_gates: number;
  esp: number;
  ops: Record<string, number>;
}

export interface Gate {
  name: string;
  qubits: number[];
  column: number;
  param: string | null;
}

export interface Drawing {
  qubits: number;
  columns: number;
  gates: Gate[];
}

export interface BitstringRow {
  bits: string;
  probability: number;
  energy: number;
  feasible: boolean;
}

export interface Landscape {
  gammas: number[];
  betas: number[];
  energy: number[][];
  minimum: { gamma: number; beta: number; energy: number };
  optimised: { gamma: number; beta: number } | null;
}

export interface OptimiseResult {
  tickers: string[];
  names: Record<string, string>;
  estimates: { mu: number[]; vol: number[]; corr: number[][]; meta: { window: number; estimator: string; shrinkage: number | null; start: string; end: string; data_hash: string; snapshot: string } };
  instance: { N: number; K: number; q: number; penalty: number; tc: number; calibration: { penalty: number; method: string; sufficient_bound: number | null; floor?: number | null; feasibility: number | null; target: number | null } };
  qubo: { Q: number[][]; constant: number; h: number[]; J: number[][]; offset: number };
  portfolios: PortfolioRow[];
  frontier: { ret: number; vol: number }[];
  max_sharpe: { expected_return: number; volatility: number; sharpe: number; weights: Record<string, number> };
  cloud: { ret: number; vol: number; objective: number; bits: string }[];
  qaoa: {
    mode: string;
    p: number;
    objective_kind: string;
    alpha: number;
    optimiser: string;
    mixer: string;
    shots: number;
    gammas: number[];
    betas: number[];
    trace: number[];
    best_trace: number[];
    objective_evaluations: number;
    seed_evaluations: number;
    energy_evaluations: number;
    feasibility_rate: number;
    success_probability: number | null;
    decoded_from: string;
    histogram: BitstringRow[];
    approximation_ratio?: number;
    approximation_ratio_feasible?: number;
    expected_energy?: number;
    resources?: Resources;
    gates?: Drawing;
    landscape?: Landscape;
  };
  noisy_qaoa: { feasibility_rate: number; success_probability: number | null; approximation_ratio?: number; histogram: BitstringRow[]; noise: { p1: number; p2: number; readout: number } } | null;
  miqp: { nodes: number; lower_bound: number; mip_gap: number; timed_out: boolean };
  matched_budget_evals: number;
}

export interface RiskResult {
  alpha: number;
  horizon_days: number;
  n_qubits: number;
  scenarios: number;
  portfolio: { label: string; weights: Record<string, number> };
  histogram: { grid: number[]; probabilities: number[] };
  continuous: { var: number; cvar: number };
  exact_discrete: { var_index: number; var: number; cvar: number; tail_probability: number; cdf_at_var: number };
  discretisation_error: { var: number; cvar: number };
  qae: { var: number; cvar: number; queries: number; var_error: number; cvar_error: number; epsilon: number; bisection: { index: number; loss: number; cdf: number; queries: number }[] };
  monte_carlo: { var: number; cvar: number; var_error: number; cvar_error: number; queries: number; repeats: number };
  scaling: {
    truth: number;
    repeats: number;
    qae_slope: number | null;
    mc_slope: number | null;
    rows: { epsilon: number; queries: number; qae_error: number; qae_q1: number; qae_q3: number; mc_error: number; mc_q1: number; mc_q3: number; max_power: number }[];
  };
  circuit_cost: { qubits: number; a: { depth: number; two_qubit: number; one_qubit: number }; q: { depth: number; two_qubit: number; one_qubit: number }; powers: { k: number; depth_upper_bound: number; two_qubit: number }[] };
  noise_study: {
    n_qubits: number;
    truth: number;
    noise: { p1: number; p2: number; readout: number };
    rows: { k: number; ideal: number; noisy: number; deviation: number; depth: number; two_qubit: number }[];
    noisy_iqae: { estimate: number; error: number; queries: number; stalled: boolean; max_power: number };
    ideal_iqae: { estimate: number; error: number; queries: number; max_power: number };
  } | null;
}

export interface RegimePortfolio {
  mean_return: number;
  median_return: number;
  volatility: number;
  probability_of_loss: number;
  var: number;
  cvar: number;
  mean_max_drawdown: number;
  worst_max_drawdown: number;
  fan: { p05: number[]; p25: number[]; p50: number[]; p75: number[]; p95: number[] };
  samples: number[][];
  terminal: { counts: number[]; edges: number[] };
}

export interface SimulateResult {
  tickers: string[];
  model: string;
  horizon_days: number;
  paths: number;
  alpha: number;
  regimes: Record<string, { label: string; parameters: { vol_scale: number; corr_push: number; drift_shift: number }; portfolios: Record<string, RegimePortfolio> }>;
  portfolio_weights: Record<string, number[]>;
  payoff: { strike: number; n_qubits: number; exact_discrete: number; qae: number; qae_error: number; qae_queries: number; mc_median: number; mc_error: number; mc_samples: number; portfolio: string } | null;
}

export interface Summary {
  median: number;
  q1: number;
  q3: number;
  count: number;
}

export interface BenchmarkRow {
  solver: string;
  family: string;
  N: number;
  K: number;
  samples: number;
  found_optimum_rate: number;
  qubits: number | null;
  gap: Summary | null;
  runtime: Summary | null;
  evaluations: Summary | null;
  feasibility_rate: Summary | null;
  success_probability: Summary | null;
  approximation_ratio: Summary | null;
  approximation_ratio_feasible: Summary | null;
  depth: Summary | null;
  two_qubit: Summary | null;
  routed_depth: Summary | null;
  routed_two_qubit: Summary | null;
  ex_ante_sharpe: Summary | null;
  oos_return: Summary | null;
  oos_sharpe: Summary | null;
  oos_max_drawdown: Summary | null;
}

export interface BenchmarkResult {
  as_of: string;
  holdout_start: string;
  holdout_end: string;
  records: Record<string, unknown>[];
  aggregate: BenchmarkRow[];
  paired_tests: { solver: string; baseline: string; N: number; metric: string; pairs: number; median_difference: number; q1: number; q3: number; p_value: number; significant: boolean }[];
  baseline_agreement: { checked: number; agree: number; certified: number };
  matched_budget_evals: number;
  notes: string[];
}

export interface BacktestResult {
  tickers: string[];
  first_date: string;
  dates: string[];
  rebalances: number;
  strategies: Record<string, { label: string; metrics: { return: number; volatility: number; sharpe: number | null; max_drawdown: number; var: number; cvar: number; total_return: number }; nav: number[]; drawdown: number[]; rolling_sharpe: (number | null)[]; turnover: number | null }>;
  assumptions: { window: number; rebalance: number; transaction_bps: number; risk_free: number; survivorship: string };
}

export interface CircuitPreview {
  tickers: string[];
  n: number;
  p: number;
  K: number;
  mixer: string;
  penalty: number;
  resources: Resources;
  drawing: Drawing;
  statevector_memory_bytes: number;
}

export interface CircuitScaling {
  p: number;
  rows: { n: number; logical_two_qubit: number; depth: number; two_qubit: number; routed_depth: number; routed_two_qubit: number; esp_all_to_all: number; esp_heavy_hex: number }[];
  encoding: { n_assets: number; b1: number; b2: number; b3: number; b4: number }[];
  statevector_limit_qubits: number;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

function detailMessage(detail: unknown): string {
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) return detail.map((d) => d.msg ?? JSON.stringify(d)).join("; ");
  return "The request failed";
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...init?.headers },
    });
  } catch {
    throw new ApiError("The QANTUM backend is not reachable. Start it with python -m qantum.", 0);
  }
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new ApiError(detailMessage(body?.detail), response.status);
  }
  return response.json();
}

export const post = <T,>(path: string, body?: unknown) =>
  api<T>(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });
