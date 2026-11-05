"""Export one real instance for the landing page, where QAOA runs live in the browser.

Usage: python -m qantum.export_hero
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np

from .config import PROJECT_ROOT
from .data import estimate, load_snapshot, select_universe
from .formulation import PortfolioInstance, calibrate_penalty, ising
from .quantum.kernel import ising_scale
from .solvers import QaoaConfig, solve_brute_force, solve_qaoa

OUTPUT = PROJECT_ROOT / "frontend" / "src" / "data" / "hero-instance.json"


def main(path: Path = OUTPUT) -> None:
    n, K = 10, 5
    tickers = select_universe(n)
    estimates = estimate(tickers)
    instance = PortfolioInstance(tickers, estimates.mu, estimates.sigma, K=K, q=3.0)
    instance.penalty = calibrate_penalty(instance)["penalty"]
    Q, constant = instance.qubo()
    h, J, _ = ising(Q, constant)

    # This instance is a demonstration whose optimum is known, so the search is spent generously
    # and the angles with the highest P(optimum) are kept. Benchmarks do not select this way.
    schedules = []
    for p in range(1, 6):
        attempts = [
            solve_qaoa(
                instance,
                config=QaoaConfig(p=p, alpha=alpha, maxiter=400, restarts=4, seed_points=512, seed=seed, resources=False),
            )
            for seed in (11, 23, 37)
            for alpha in (0.1, 0.2)
        ]
        result = max(attempts, key=lambda attempt: attempt.extras["success_probability"])
        schedules.append(
            {
                "p": p,
                "gammas": np.round(result.extras["gammas"], 5).tolist(),
                "betas": np.round(result.extras["betas"], 5).tolist(),
                "success": round(result.extras["success_probability"], 5),
            }
        )
        print(f"p = {p}: P(optimum) = {schedules[-1]['success']}", flush=True)

    names = {t["symbol"]: t["name"] for t in load_snapshot().meta["tickers"]}
    optimum = solve_brute_force(instance)
    payload = {
        "tickers": tickers,
        "names": [names[t] for t in tickers],
        "K": K,
        "q": instance.q,
        "penalty": round(instance.penalty, 6),
        "Q": np.round(Q, 8).tolist(),
        "constant": round(constant, 8),
        "scale": round(ising_scale(h, J), 8),
        "offset": round(ising(Q, constant)[2], 8),
        "mu": np.round(estimates.mu, 5).tolist(),
        "vol": np.round(estimates.vol, 5).tolist(),
        "optimum": [int(b) for b in optimum.x],
        "schedules": schedules,
        "gamma_max": round(result.extras["gamma_max"], 4),
        "as_of": estimates.meta["end"],
        "data_hash": estimates.meta["data_hash"][:12],
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload))
    print(f"Wrote {path}: optimum {[t for t, b in zip(tickers, optimum.x) if b]}")
    print({s["p"]: s["success"] for s in schedules})


if __name__ == "__main__":
    main()
