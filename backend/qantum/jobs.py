"""Background execution of experiments. Live progress is held in memory, results in the store."""

from __future__ import annotations

import threading
import time
import traceback
from concurrent.futures import ThreadPoolExecutor
from dataclasses import asdict
from datetime import datetime, timezone
from math import comb
from typing import Callable

import numpy as np

from . import store
from .backtest import BacktestSpec, run_backtest
from .config import JOB_WORKERS
from .data import build_snapshot, estimate, load_snapshot, select_universe
from .formulation import PortfolioInstance, bitstring, calibrate_penalty, ising
from .harness import BenchmarkSpec, run_benchmark
from .metrics import ex_ante, optimality_gap, path_metrics
from .risk import run_risk_analysis
from .simulation import run_market_simulation
from .solvers import (
    Budget,
    QaoaConfig,
    efficient_frontier,
    max_sharpe,
    solve_brute_force,
    solve_miqp,
    solve_mvo,
    solve_qaoa,
    solve_simulated_annealing,
)

executor = ThreadPoolExecutor(max_workers=JOB_WORKERS, thread_name_prefix="qantum-run")
_live: dict[str, dict] = {}
_lock = threading.Lock()


def live_state(run_id: str) -> dict | None:
    with _lock:
        state = _live.get(run_id)
        return dict(state) if state else None


def _set_live(run_id: str, **fields) -> None:
    with _lock:
        _live.setdefault(run_id, {"progress": 0.0, "message": "Queued", "partial": None}).update(fields)


def _portfolio_row(label: str, result, instance: PortfolioInstance, optimum: float | None, history: np.ndarray) -> dict:
    x = result.x
    weights = result.weights if result.weights is not None else x / instance.K
    planned = ex_ante(weights, instance.mu, instance.sigma)
    realised = path_metrics(np.expm1(history) @ weights)
    extras = result.extras
    resources = extras.get("resources") or {}
    binary = result.weights is None
    return {
        "label": label,
        "solver": result.solver,
        "bits": bitstring(x) if binary else None,
        "tickers": [t for t, w in zip(instance.tickers, weights) if w > 1e-4],
        "weights": {t: float(w) for t, w in zip(instance.tickers, weights) if w > 1e-4},
        "objective": result.objective if binary else None,
        "gap": max(optimality_gap(result.objective, optimum), 0.0) if binary and optimum is not None else None,
        "certified": result.certified,
        "expected_return": planned["expected_return"],
        "volatility": planned["volatility"],
        "sharpe": planned["sharpe"],
        "in_sample": realised,
        "runtime": result.runtime,
        "evaluations": result.evaluations,
        "qubits": resources.get("qubits"),
        "depth": (resources.get("all_to_all") or {}).get("depth"),
        "two_qubit": (resources.get("all_to_all") or {}).get("two_qubit_gates"),
        "routed_depth": (resources.get("heavy_hex") or {}).get("depth"),
        "routed_two_qubit": (resources.get("heavy_hex") or {}).get("two_qubit_gates"),
        "feasibility_rate": extras.get("feasibility_rate"),
        "success_probability": extras.get("success_probability"),
        "approximation_ratio": extras.get("approximation_ratio"),
        "approximation_ratio_feasible": extras.get("approximation_ratio_feasible"),
        "mode": extras.get("mode"),
    }


def _binary_cloud(instance: PortfolioInstance, limit: int = 2500, seed: int = 1) -> list[dict]:
    """Candidate equal-weight portfolios for the frontier scatter (Figure 6.1 on real data)."""
    n, K = instance.n, instance.K
    rng = np.random.default_rng(seed)
    if comb(n, K) <= limit:
        from itertools import combinations

        subsets = [list(c) for c in combinations(range(n), K)]
    else:
        subsets = [list(rng.choice(n, K, replace=False)) for _ in range(limit)]
    cloud = []
    for subset in subsets:
        w = np.zeros(n)
        w[subset] = 1 / K
        x = np.zeros(n)
        x[subset] = 1
        cloud.append(
            {
                "ret": float(instance.mu @ w),
                "vol": float(np.sqrt(w @ instance.sigma @ w)),
                "objective": instance.objective(x),
                "bits": bitstring(x.astype(int)),
            }
        )
    return cloud


def run_optimise(spec: dict, report: Callable) -> tuple[dict, dict]:
    tickers = select_universe(
        spec["n"], mode=spec.get("universe", "top_weight"), seed=spec.get("seed", 7), tickers=spec.get("tickers"), window=spec.get("window", 252)
    )
    estimates = estimate(tickers, window=spec.get("window", 252), estimator=spec.get("estimator", "ledoit_wolf"))
    instance = PortfolioInstance(tickers, estimates.mu, estimates.sigma, K=spec["K"], q=spec.get("q", 3.0), tc=spec.get("tc", 0.0), meta=estimates.meta)

    report(0.05, "Calibrating the penalty")
    if spec.get("penalty") is None:
        calibration = calibrate_penalty(instance)
    else:
        calibration = {"penalty": float(spec["penalty"]), "method": "manual", "sufficient_bound": None, "feasibility": None, "target": None}
    instance.penalty = calibration["penalty"]

    report(0.1, "Solving the exact MIQP")
    exact = solve_miqp(instance, Budget(time_limit=spec.get("miqp_time_limit", 90)))
    brute = solve_brute_force(instance) if instance.n <= 20 else None
    optimum = brute.objective if brute else exact.objective

    qaoa_spec = {key: value for key, value in (spec.get("qaoa") or {}).items() if key in QaoaConfig.__dataclass_fields__}
    config = QaoaConfig(seed=spec.get("seed", 7), **qaoa_spec)

    def on_trace(partial: dict) -> None:
        planned = max(config.seed_points + config.maxiter * config.restarts, 1)
        report(0.15 + 0.5 * min(partial["evaluations"] / planned, 1.0), f"QAOA evaluation {partial['evaluations']}", partial)

    report(0.15, "Running QAOA")
    quantum = solve_qaoa(instance, config=config, ground_truth=optimum, on_progress=on_trace, include_landscape=instance.n <= 14)

    report(0.7, "Annealing at the matched budget")
    annealed = solve_simulated_annealing(instance, Budget(energy_evals=quantum.extras["energy_evaluations"]), seed=config.seed)

    history = load_snapshot().log_returns[tickers].tail(spec.get("window", 252)).to_numpy()
    continuous = solve_mvo(instance)

    label = f"QAOA p={config.p}"
    rows = [
        _portfolio_row("Exact MIQP", exact, instance, optimum, history),
        _portfolio_row("Simulated annealing", annealed, instance, optimum, history),
        _portfolio_row(label, quantum, instance, optimum, history),
    ]
    if brute:
        rows.insert(1, _portfolio_row("Brute force", brute, instance, optimum, history))

    noisy = None
    if spec.get("compare_noise", True) and config.mode == "statevector" and config.mixer == "x" and instance.n <= spec.get("noise_max_n", 12):
        report(0.8, "Sampling on the noise model")
        noisy = solve_qaoa(instance, config=QaoaConfig(**{**asdict(config), "mode": "noise", "resources": False}), ground_truth=optimum)
        rows.append(_portfolio_row(f"{label} + noise", noisy, instance, optimum, history))
    rows.append(_portfolio_row("Continuous MVO", continuous, instance, optimum, history))

    report(0.9, "Computing the frontier")
    Q, constant = instance.qubo()
    h, J, offset = ising(Q, constant)
    frontier = efficient_frontier(instance.mu, instance.sigma)
    sharpe = max_sharpe(instance.mu, instance.sigma)

    result = {
        "tickers": tickers,
        "names": {t["symbol"]: t["name"] for t in load_snapshot().meta["tickers"]},
        "estimates": {
            "mu": estimates.mu,
            "vol": estimates.vol,
            "corr": estimates.corr,
            "meta": estimates.meta,
        },
        "instance": {"N": instance.n, "K": instance.K, "q": instance.q, "penalty": instance.penalty, "tc": instance.tc, "calibration": calibration},
        "qubo": {"Q": Q, "constant": constant, "h": h, "J": J, "offset": offset},
        "portfolios": rows,
        "frontier": [{"ret": f["ret"], "vol": f["vol"]} for f in frontier],
        "max_sharpe": {**ex_ante(sharpe, instance.mu, instance.sigma), "weights": dict(zip(tickers, sharpe.tolist()))},
        "cloud": _binary_cloud(instance),
        "qaoa": {k: v for k, v in quantum.extras.items()},
        "noisy_qaoa": {k: noisy.extras[k] for k in ("feasibility_rate", "success_probability", "approximation_ratio", "histogram", "noise", "decoded_from")} if noisy else None,
        "miqp": exact.extras,
        "matched_budget_evals": quantum.extras["energy_evaluations"],
    }
    row = next(r for r in rows if r["label"] == label)
    summary = {
        "N": instance.n,
        "K": instance.K,
        "p": config.p,
        "mode": config.mode,
        "gap": row["gap"],
        "sharpe": row["sharpe"],
        "success_probability": row["success_probability"],
        "tickers": row["tickers"],
    }
    return result, summary


def _portfolio_weights_from_run(run_id: str | None) -> tuple[list[str], dict[str, np.ndarray], str | None]:
    """Load the quantum and classical picks of an optimise run, defaulting to the latest one."""
    source = store.get_run(run_id) if run_id else store.latest_finished("optimise")
    if source is None or not source.result:
        return [], {}, None
    tickers = source.result["tickers"]
    portfolios = {}
    for row in source.result["portfolios"]:
        if row["label"] in ("Exact MIQP", "Continuous MVO") or (row["label"].startswith("QAOA") and "noise" not in row["label"]):
            portfolios[row["label"]] = np.array([row["weights"].get(t, 0.0) for t in tickers])
    return tickers, portfolios, source.id


def run_risk(spec: dict, report: Callable) -> tuple[dict, dict]:
    tickers, portfolios, source_id = _portfolio_weights_from_run(spec.get("source_run"))
    if spec.get("tickers"):
        tickers = spec["tickers"]
        weights = np.full(len(tickers), 1 / len(tickers))
        label = "Equal weight"
    elif portfolios:
        label = spec.get("portfolio") or next((name for name in portfolios if name.startswith("QAOA")), next(iter(portfolios)))
        weights = portfolios[label]
    else:
        tickers = select_universe(10)
        weights = np.full(10, 0.1)
        label = "Equal weight"
    estimates = estimate(tickers, window=spec.get("window", 252))
    result = run_risk_analysis(
        weights,
        estimates.mu,
        estimates.sigma,
        alpha=spec.get("alpha", 0.95),
        horizon_days=spec.get("horizon_days", 1),
        n_qubits=spec.get("n_qubits", 5),
        epsilon=spec.get("epsilon", 0.005),
        shots=spec.get("shots", 100),
        scenarios=spec.get("scenarios", 200_000),
        seed=spec.get("seed", 7),
        include_noise=spec.get("include_noise", True),
        noise_scale=spec.get("noise_scale", 1.0),
        on_progress=lambda fraction, message: report(fraction, message),
    )
    result["portfolio"] = {"label": label, "weights": {t: float(w) for t, w in zip(tickers, weights) if w > 1e-4}}
    result["source_run"] = source_id
    result["estimates_meta"] = estimates.meta
    summary = {
        "portfolio": label,
        "alpha": result["alpha"],
        "var_exact": result["exact_discrete"]["var"],
        "cvar_exact": result["exact_discrete"]["cvar"],
        "qae_queries": result["qae"]["queries"],
        "qae_slope": result["scaling"]["qae_slope"],
        "mc_slope": result["scaling"]["mc_slope"],
    }
    return result, summary


def run_simulate(spec: dict, report: Callable) -> tuple[dict, dict]:
    tickers, portfolios, source_id = _portfolio_weights_from_run(spec.get("source_run"))
    if not portfolios:
        tickers = select_universe(10)
        portfolios = {"Equal weight": np.full(10, 0.1)}
    window = spec.get("window", 252)
    estimates = estimate(tickers, window=window)
    history = load_snapshot().log_returns[tickers].tail(window).to_numpy()
    result = run_market_simulation(
        tickers,
        estimates.mu,
        estimates.sigma,
        history,
        portfolios,
        horizon_days=spec.get("horizon_days", 63),
        paths=spec.get("paths", 4000),
        model=spec.get("model", "gbm"),
        alpha=spec.get("alpha", 0.95),
        seed=spec.get("seed", 7),
        on_progress=lambda fraction, message: report(fraction, message),
    )
    result["source_run"] = source_id
    result["estimates_meta"] = estimates.meta
    return result, {"portfolios": list(portfolios), "model": result["model"], "horizon_days": result["horizon_days"]}


def run_benchmark_job(spec: dict, report: Callable) -> tuple[dict, dict]:
    fields = {k: v for k, v in spec.items() if k in BenchmarkSpec.__dataclass_fields__}
    result = run_benchmark(BenchmarkSpec(**fields), on_progress=lambda f, m, partial=None: report(f, m, partial))
    agreement = result["baseline_agreement"]
    return result, {
        "sizes": spec.get("sizes"),
        "depths": spec.get("depths"),
        "instances": spec.get("instances"),
        "records": len(result["records"]),
        "baseline_agree": f"{agreement['agree']}/{agreement['checked']}",
    }


def run_backtest_job(spec: dict, report: Callable) -> tuple[dict, dict]:
    fields = {k: v for k, v in spec.items() if k in BacktestSpec.__dataclass_fields__}
    result = run_backtest(BacktestSpec(**fields), on_progress=lambda f, m, partial=None: report(f, m, partial))
    return result, {
        "tickers": result["tickers"],
        "rebalances": result["rebalances"],
        "sharpe": {name: value["metrics"].get("sharpe") for name, value in result["strategies"].items()},
    }


def run_refresh(spec: dict, report: Callable) -> tuple[dict, dict]:
    report(0.1, "Downloading prices from Yahoo Finance")
    meta = build_snapshot(years=spec.get("years", 6))
    summary = {"snapshot": meta["id"], "sessions": meta["sessions"], "symbols": len(meta["tickers"]), "end": meta["end"]}
    return {"snapshot": {k: v for k, v in meta.items() if k != "tickers"}, "excluded": meta["excluded"]}, summary


HANDLERS: dict[str, Callable] = {
    "optimise": run_optimise,
    "risk": run_risk,
    "simulate": run_simulate,
    "benchmark": run_benchmark_job,
    "backtest": run_backtest_job,
    "refresh": run_refresh,
}


def _execute(run_id: str, kind: str, spec: dict) -> None:
    def report(fraction: float, message: str, partial: dict | None = None) -> None:
        _set_live(run_id, progress=float(fraction), message=message, **({"partial": partial} if partial else {}))

    store.update_run(run_id, status="running")
    _set_live(run_id, message="Starting")
    started = time.perf_counter()
    try:
        result, summary = HANDLERS[kind](spec, report)
        summary = {**summary, "runtime": time.perf_counter() - started}
        store.update_run(run_id, status="finished", result=result, summary=summary, finished_at=datetime.now(timezone.utc))
    except Exception as error:  # A failed experiment is a stored record, not a crash.
        store.update_run(
            run_id,
            status="failed",
            error=f"{error}\n\n{traceback.format_exc(limit=6)}",
            finished_at=datetime.now(timezone.utc),
        )
    finally:
        with _lock:
            _live.pop(run_id, None)


def submit(kind: str, title: str, spec: dict) -> store.Run:
    if kind not in HANDLERS:
        raise ValueError(f"Unknown run kind {kind!r}")
    data_hash = None
    try:
        data_hash = load_snapshot().meta["sha256"]
    except FileNotFoundError:
        if kind != "refresh":
            raise
    run = store.create_run(kind, title, spec, data_hash)
    _set_live(run.id)
    executor.submit(_execute, run.id, kind, spec)
    return run


REFERENCE_RUNS = [
    (
        "optimise",
        "Reference: top 10 by weight, K = 5, p = 5",
        {"n": 10, "K": 5, "q": 3.0, "seed": 11, "qaoa": {"p": 5, "objective": "cvar", "alpha": 0.2, "maxiter": 300, "seed_points": 512, "restarts": 4}},
    ),
    ("risk", "Reference: QAOA pick, VaR and CVaR at 95%", {"alpha": 0.95, "n_qubits": 5, "seed": 7}),
    ("simulate", "Reference: stress regimes over one quarter", {"horizon_days": 63, "paths": 4000, "seed": 7}),
    (
        "benchmark",
        "Reference grid: N 6 to 12, p in 1, 3, 5",
        {"sizes": [6, 8, 10, 12], "depths": [1, 3, 5], "instances": 5, "initialisations": 2, "maxiter": 150, "seed_points": 256, "seed": 2026, "include_noise": True, "noise_max_n": 8},
    ),
    ("backtest", "Reference walk-forward: three years, N = 10, K = 5", {"n": 10, "K": 5, "years": 3.0, "p": 2, "maxiter": 60}),
]


def seed_reference_runs() -> None:
    """Populate an empty store in dependency order, one at a time, so the first launch has data."""

    def worker() -> None:
        for kind, title, spec in REFERENCE_RUNS:
            run = submit(kind, title, spec)
            while True:
                time.sleep(0.5)
                current = store.get_run(run.id)
                if current is None or current.status in ("finished", "failed", "interrupted"):
                    break

    if store.count_runs() == 0:
        threading.Thread(target=worker, name="qantum-seed", daemon=True).start()
