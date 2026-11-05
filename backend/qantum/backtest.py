"""Walk-forward, out-of-sample evaluation from section 11.3.

Parameters are estimated on a rolling window, the portfolio is held for a rebalancing period,
and the window rolls forward. Today's constituents are used for history, so survivorship bias
is present and is stated in every result.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable

import numpy as np

from .config import RISK_FREE_RATE, TRADING_DAYS
from .data import estimate, load_snapshot, select_universe
from .formulation import PortfolioInstance, calibrate_penalty
from .metrics import path_metrics
from .solvers import Budget, QaoaConfig, max_sharpe, solve_miqp, solve_qaoa, solve_simulated_annealing

ALL_STRATEGIES = ("equal_weight", "mvo", "miqp", "simulated_annealing", "qaoa")
LABELS = {
    "equal_weight": "Equal weight",
    "mvo": "Continuous MVO",
    "miqp": "Exact MIQP",
    "simulated_annealing": "Simulated annealing",
    "qaoa": "QAOA",
    "index": "NIFTY 50 index",
}


@dataclass
class BacktestSpec:
    n: int = 10
    K: int = 5
    q: float = 3.0
    window: int = 252
    rebalance: int = 21
    years: float = 3.0
    transaction_bps: float = 10.0
    p: int = 2
    objective: str = "cvar"
    alpha: float = 0.2
    shots: int = 1024
    maxiter: int = 80
    seed_points: int = 64
    seed: int = 7
    universe: str = "top_weight"
    tickers: list[str] | None = None
    strategies: list[str] = field(default_factory=lambda: list(ALL_STRATEGIES))


def run_backtest(spec: BacktestSpec, on_progress: Callable[[float, str, dict | None], None] | None = None) -> dict:
    report = on_progress or (lambda fraction, message, partial=None: None)
    snapshot = load_snapshot()
    returns_log = snapshot.log_returns
    sessions = returns_log.index
    hold_total = int(spec.years * TRADING_DAYS)
    if len(sessions) < spec.window + spec.rebalance + 2:
        raise ValueError("The snapshot is too short for this walk-forward configuration")
    first_rebalance = max(spec.window, len(sessions) - hold_total)
    first_date = sessions[first_rebalance - 1]

    # The universe must exist through the entire test, which is the survivorship caveat.
    tickers = select_universe(
        spec.n, mode=spec.universe, seed=spec.seed, tickers=spec.tickers, window=len(sessions) - first_rebalance + spec.window
    )
    returns_simple = np.expm1(returns_log[tickers])
    index_simple = np.expm1(np.log(snapshot.prices[snapshot.meta["index"]] / snapshot.prices[snapshot.meta["index"]].shift(1)))

    rebalance_points = list(range(first_rebalance, len(sessions), spec.rebalance))
    daily: dict[str, list[float]] = {s: [] for s in spec.strategies}
    current: dict[str, np.ndarray] = {s: np.zeros(len(tickers)) for s in spec.strategies}
    selections: dict[str, list[dict]] = {s: [] for s in spec.strategies}
    turnover: dict[str, float] = {s: 0.0 for s in spec.strategies}
    dates: list[str] = []
    index_daily: list[float] = []
    cost_rate = spec.transaction_bps / 10_000

    for step, start in enumerate(rebalance_points):
        as_of = sessions[start - 1]
        estimates = estimate(tickers, window=spec.window, end=as_of)
        instance = PortfolioInstance(tickers, estimates.mu, estimates.sigma, K=spec.K, q=spec.q)
        instance.penalty = calibrate_penalty(instance)["penalty"]
        seed = spec.seed + step

        for strategy in spec.strategies:
            if strategy == "equal_weight":
                weights = np.full(len(tickers), 1 / len(tickers))
            elif strategy == "mvo":
                weights = max_sharpe(estimates.mu, estimates.sigma)
            else:
                if strategy == "miqp":
                    result = solve_miqp(instance, Budget(time_limit=30))
                elif strategy == "simulated_annealing":
                    result = solve_simulated_annealing(
                        instance, Budget(energy_evals=(spec.maxiter + spec.seed_points) * spec.shots), seed=seed
                    )
                else:
                    result = solve_qaoa(
                        instance,
                        config=QaoaConfig(
                            p=spec.p,
                            objective=spec.objective,
                            alpha=spec.alpha,
                            shots=spec.shots,
                            maxiter=spec.maxiter,
                            seed_points=spec.seed_points,
                            restarts=1,
                            seed=seed,
                            resources=False,
                        ),
                    )
                weights = result.x / spec.K
                selections[strategy].append({"date": as_of.strftime("%Y-%m-%d"), "tickers": [t for t, b in zip(tickers, result.x) if b]})
            change = np.abs(weights - current[strategy]).sum()
            turnover[strategy] += change / 2
            current[strategy] = weights
            daily[strategy].append(-change * cost_rate)  # charged on the first held session below

        end = min(start + spec.rebalance, len(sessions))
        block = returns_simple.iloc[start:end].to_numpy()
        for strategy in spec.strategies:
            cost = daily[strategy].pop()
            drifting = current[strategy].copy()
            for day, row in enumerate(block):
                gross = float(drifting @ row)
                daily[strategy].append(gross + (cost if day == 0 else 0.0))
                drifting = drifting * (1 + row) / (1 + gross) if (1 + gross) else drifting
        dates.extend(d.strftime("%Y-%m-%d") for d in sessions[start:end])
        index_daily.extend(index_simple.iloc[start:end].fillna(0.0).tolist())
        report((step + 1) / len(rebalance_points), f"Rebalance {step + 1} of {len(rebalance_points)}", None)

    series = {**daily, "index": index_daily}
    results = {}
    rolling_window = 63
    for name, values in series.items():
        values_array = np.array(values)
        nav = np.cumprod(1 + values_array)
        peak = np.maximum.accumulate(nav)
        rolling = []
        for i in range(len(values_array)):
            if i + 1 < rolling_window:
                rolling.append(None)
                continue
            chunk = values_array[i + 1 - rolling_window : i + 1]
            std = chunk.std(ddof=1)
            rolling.append(float((chunk.mean() * TRADING_DAYS - RISK_FREE_RATE) / (std * np.sqrt(TRADING_DAYS))) if std else None)
        results[name] = {
            "label": LABELS.get(name, name),
            "metrics": path_metrics(values_array),
            "nav": nav.round(5).tolist(),
            "drawdown": ((nav - peak) / peak).round(5).tolist(),
            "rolling_sharpe": [None if r is None else round(r, 3) for r in rolling],
            "turnover": turnover.get(name),
        }

    return {
        "tickers": tickers,
        "first_date": first_date.strftime("%Y-%m-%d"),
        "dates": dates,
        "rebalances": len(rebalance_points),
        "strategies": results,
        "selections": selections,
        "assumptions": {
            "window": spec.window,
            "rebalance": spec.rebalance,
            "transaction_bps": spec.transaction_bps,
            "risk_free": RISK_FREE_RATE,
            "survivorship": "Today's constituents are used for history, so survivorship bias is present.",
        },
    }
