"""Module 5: benchmark harness. One instance, one budget, every solver, identical metrics."""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field
from typing import Callable

import numpy as np
import pandas as pd
from scipy import stats

from .config import MAX_EXACT_QUBITS
from .data import eligible_symbols, estimate, load_snapshot
from .formulation import PortfolioInstance, bitstring, calibrate_penalty
from .metrics import ex_ante, optimality_gap, path_metrics
from .solvers import Budget, QaoaConfig, SolverResult, solve_brute_force, solve_miqp, solve_qaoa, solve_simulated_annealing


@dataclass
class BenchmarkSpec:
    sizes: list[int] = field(default_factory=lambda: [6, 8, 10, 12])
    depths: list[int] = field(default_factory=lambda: [1, 2, 3])
    instances: int = 5
    initialisations: int = 3
    objective: str = "cvar"
    alpha: float = 0.2
    optimiser: str = "COBYLA"
    shots: int = 1024
    maxiter: int = 120
    seed_points: int = 128
    q: float = 3.0
    window: int = 252
    holdout: int = 63
    include_noise: bool = False
    noise_max_n: int = 8
    noise_scale: float = 1.0
    small_k: bool = False
    seed: int = 2026


def _record(
    result: SolverResult,
    label: str,
    instance: PortfolioInstance,
    optimum: float,
    instance_id: str,
    holdout: pd.DataFrame,
    extra: dict | None = None,
) -> dict:
    weights = result.x / instance.K
    held = np.expm1(holdout[instance.tickers].to_numpy()) @ weights
    oos = path_metrics(held)
    planned = ex_ante(weights, instance.mu, instance.sigma)
    extras = result.extras
    resources = extras.get("resources") or {}
    return {
        "instance": instance_id,
        "solver": label,
        "family": result.solver,
        "N": instance.n,
        "K": instance.K,
        "objective": result.objective,
        "gap": max(optimality_gap(result.objective, optimum), 0.0),
        "found_optimum": bool(abs(result.objective - optimum) < 1e-9),
        "bits": bitstring(result.x),
        "runtime": result.runtime,
        "evaluations": result.evaluations,
        "feasibility_rate": extras.get("feasibility_rate"),
        "success_probability": extras.get("success_probability"),
        "approximation_ratio": extras.get("approximation_ratio"),
        "approximation_ratio_feasible": extras.get("approximation_ratio_feasible"),
        "qubits": resources.get("qubits"),
        "depth": (resources.get("all_to_all") or {}).get("depth"),
        "two_qubit": (resources.get("all_to_all") or {}).get("two_qubit_gates"),
        "routed_depth": (resources.get("heavy_hex") or {}).get("depth"),
        "routed_two_qubit": (resources.get("heavy_hex") or {}).get("two_qubit_gates"),
        "ex_ante_sharpe": planned["sharpe"],
        "oos_return": oos.get("total_return"),
        "oos_sharpe": oos.get("sharpe"),
        "oos_max_drawdown": oos.get("max_drawdown"),
        "oos_cvar": oos.get("cvar"),
        **(extra or {}),
    }


def _summary(values: list[float]) -> dict | None:
    clean = [v for v in values if v is not None and np.isfinite(v)]
    if not clean:
        return None
    return {
        "median": float(np.median(clean)),
        "q1": float(np.quantile(clean, 0.25)),
        "q3": float(np.quantile(clean, 0.75)),
        "count": len(clean),
    }


def aggregate(records: list[dict]) -> list[dict]:
    groups: dict[tuple, list[dict]] = defaultdict(list)
    for record in records:
        groups[(record["solver"], record["N"], record["K"])].append(record)
    rows = []
    for (solver, n, k), group in sorted(groups.items(), key=lambda item: (item[0][1], item[0][2], item[0][0])):
        row = {
            "solver": solver,
            "family": group[0]["family"],
            "N": n,
            "K": k,
            "samples": len(group),
            "found_optimum_rate": float(np.mean([r["found_optimum"] for r in group])),
        }
        for metric in (
            "gap",
            "runtime",
            "evaluations",
            "feasibility_rate",
            "success_probability",
            "approximation_ratio",
            "approximation_ratio_feasible",
            "depth",
            "two_qubit",
            "routed_depth",
            "routed_two_qubit",
            "ex_ante_sharpe",
            "oos_return",
            "oos_sharpe",
            "oos_max_drawdown",
        ):
            row[metric] = _summary([r.get(metric) for r in group])
        row["qubits"] = group[0].get("qubits")
        rows.append(row)
    return rows


def paired_tests(records: list[dict], baseline: str = "Simulated annealing") -> list[dict]:
    """Wilcoxon signed-rank on identical instances, with the median difference as effect size."""
    frame = pd.DataFrame(records)
    tests = []
    for solver in sorted(set(frame["solver"]) - {baseline, "Exact MIQP", "Brute force"}):
        for n in sorted(frame["N"].unique()):
            subset = frame[frame["N"] == n]
            for metric in ("gap", "oos_sharpe"):
                left = subset[subset["solver"] == solver].groupby("instance")[metric].median()
                right = subset[subset["solver"] == baseline].groupby("instance")[metric].median()
                joined = pd.concat([left, right], axis=1, keys=["a", "b"]).dropna()
                if len(joined) < 3:
                    continue
                difference = (joined["a"] - joined["b"]).to_numpy(dtype=float)
                if np.allclose(difference, 0.0):
                    p_value = 1.0
                else:
                    p_value = float(stats.wilcoxon(difference, zero_method="wilcox", method="auto").pvalue)
                tests.append(
                    {
                        "solver": solver,
                        "baseline": baseline,
                        "N": int(n),
                        "metric": metric,
                        "pairs": len(joined),
                        "median_difference": float(np.median(difference)),
                        "q1": float(np.quantile(difference, 0.25)),
                        "q3": float(np.quantile(difference, 0.75)),
                        "p_value": p_value,
                        "significant": p_value < 0.05,
                    }
                )
    return tests


def run_benchmark(spec: BenchmarkSpec, on_progress: Callable[[float, str, dict | None], None] | None = None) -> dict:
    report = on_progress or (lambda fraction, message, partial=None: None)
    snapshot = load_snapshot()
    sessions = snapshot.log_returns.index
    as_of = sessions[-spec.holdout - 1]
    holdout = snapshot.log_returns.iloc[-spec.holdout :]
    eligible = eligible_symbols(spec.window + spec.holdout)
    rng = np.random.default_rng(spec.seed)

    plan = []
    for n in spec.sizes:
        if n > min(len(eligible), MAX_EXACT_QUBITS):
            raise ValueError(f"N = {n} is beyond this harness's exact range")
        cardinalities = [n // 2] + ([max(2, n // 4)] if spec.small_k and max(2, n // 4) != n // 2 else [])
        for k in cardinalities:
            for i in range(spec.instances):
                plan.append((n, k, i, [str(s) for s in rng.choice(eligible, n, replace=False)]))

    records: list[dict] = []
    baseline_checks: list[dict] = []
    per_instance_runs = len(spec.depths) * spec.initialisations
    total_steps = max(len(plan) * (2 + per_instance_runs), 1)
    completed = 0

    for n, k, i, tickers in plan:
        estimates = estimate(tickers, window=spec.window, end=as_of)
        instance = PortfolioInstance(
            tickers, estimates.mu, estimates.sigma, K=k, q=spec.q,
            meta={"data_hash": estimates.meta["data_hash"]},
        )
        calibration = calibrate_penalty(instance)
        instance.penalty = calibration["penalty"]
        instance_id = f"N{n}-K{k}-{i}"

        exact = solve_miqp(instance, Budget(time_limit=120))
        brute = solve_brute_force(instance) if n <= 20 else None
        optimum = brute.objective if brute else exact.objective
        if brute:
            baseline_checks.append(
                {
                    "instance": instance_id,
                    "miqp": exact.objective,
                    "brute_force": brute.objective,
                    "agree": bool(abs(exact.objective - brute.objective) < 1e-8),
                    "certified": exact.certified,
                }
            )
        records.append(_record(exact, "Exact MIQP", instance, optimum, instance_id, holdout))
        completed += 1
        report(completed / total_steps, f"{instance_id}: classical ground truth", None)

        # Matched budget: annealing gets the energy evaluations of one QAOA configuration's starts.
        budget_evals = (spec.maxiter + spec.seed_points) * spec.shots * spec.initialisations
        annealed = solve_simulated_annealing(instance, Budget(energy_evals=budget_evals), seed=spec.seed + i * 13 + n)
        records.append(_record(annealed, "Simulated annealing", instance, optimum, instance_id, holdout))
        completed += 1

        for depth in spec.depths:
            for init in range(spec.initialisations):
                seed = spec.seed + 1009 * i + 101 * init + depth
                config = QaoaConfig(
                    p=depth,
                    objective=spec.objective,
                    alpha=spec.alpha,
                    optimiser=spec.optimiser,
                    shots=spec.shots,
                    maxiter=spec.maxiter,
                    seed_points=spec.seed_points,
                    restarts=1,
                    seed=seed,
                    resources=init == 0,
                )
                result = solve_qaoa(instance, config=config)
                records.append(_record(result, f"QAOA p={depth}", instance, optimum, instance_id, holdout, {"p": depth, "init": init}))
                if spec.include_noise and n <= spec.noise_max_n and init == 0:
                    noisy = solve_qaoa(
                        instance,
                        config=QaoaConfig(
                            p=depth,
                            mode="noise",
                            objective=spec.objective,
                            alpha=spec.alpha,
                            optimiser=spec.optimiser,
                            shots=spec.shots,
                            maxiter=spec.maxiter,
                            seed_points=spec.seed_points,
                            restarts=1,
                            seed=seed,
                            noise_scale=spec.noise_scale,
                            resources=False,
                        ),
                    )
                    records.append(_record(noisy, f"QAOA p={depth} + noise", instance, optimum, instance_id, holdout, {"p": depth, "init": init}))
                completed += 1
                report(completed / total_steps, f"{instance_id}: QAOA p={depth}, start {init + 1}", None)

    return {
        "as_of": as_of.strftime("%Y-%m-%d"),
        "holdout_start": holdout.index[0].strftime("%Y-%m-%d"),
        "holdout_end": holdout.index[-1].strftime("%Y-%m-%d"),
        "records": records,
        "aggregate": aggregate(records),
        "paired_tests": paired_tests(records),
        "baseline_agreement": {
            "checked": len(baseline_checks),
            "agree": sum(1 for c in baseline_checks if c["agree"]),
            "certified": sum(1 for c in baseline_checks if c["certified"]),
            "details": baseline_checks,
        },
        "matched_budget_evals": (spec.maxiter + spec.seed_points) * spec.shots * spec.initialisations,
        "notes": [
            "Simulator wall-clock time reflects classical emulation cost and says nothing about quantum execution time.",
            "Today's constituents are used for history, so survivorship bias is present.",
            "Small instances are easy for classical solvers by construction. These results characterise trends and do not demonstrate advantage.",
        ],
    }
