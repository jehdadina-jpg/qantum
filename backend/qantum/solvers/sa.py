"""Simulated annealing on the identical penalised QUBO that QAOA receives."""

from __future__ import annotations

import time

import numpy as np

from ..formulation import PortfolioInstance, repair
from .base import Budget, SolverResult


def solve_simulated_annealing(
    instance: PortfolioInstance,
    budget: Budget | None = None,
    seed: int = 0,
    restarts: int = 8,
) -> SolverResult:
    """Single-bit-flip Metropolis with geometric cooling. Budget counts energy evaluations."""
    budget = budget or Budget()
    start = time.perf_counter()
    rng = np.random.default_rng(seed)
    Q, constant = instance.qubo()
    n = instance.n
    diagonal = np.diag(Q).copy()
    off_diagonal = Q - np.diag(diagonal)

    spread = max(float(np.abs(Q).sum(axis=1).max()), 1e-9)
    t_start, t_end = spread, spread * 1e-4
    steps = max(budget.energy_evals // restarts, 1)
    cooling = (t_end / t_start) ** (1 / max(steps - 1, 1))

    best_x: np.ndarray | None = None
    best_objective = np.inf
    evaluations = 0
    feasible_seen = 0

    for _ in range(restarts):
        if time.perf_counter() - start > budget.time_limit:
            break
        x = (rng.random(n) < instance.K / n).astype(float)
        fields = off_diagonal @ x
        energy = float(x @ Q @ x + constant)
        temperature = t_start
        flips = rng.integers(0, n, steps)
        accept = rng.random(steps)
        for i, u in zip(flips, accept):
            evaluations += 1
            sign = 1 - 2 * x[i]
            delta = sign * (diagonal[i] + 2 * fields[i])
            if delta <= 0 or u < np.exp(-delta / temperature):
                x[i] += sign
                fields += sign * off_diagonal[i]
                energy += delta
                if x.sum() == instance.K:
                    feasible_seen += 1
                    objective = instance.objective(x)
                    if objective < best_objective:
                        best_objective, best_x = objective, x.astype(int).copy()
            temperature *= cooling

    repaired = False
    if best_x is None:
        best_x = repair(instance, (rng.random(n) < instance.K / n).astype(int))
        best_objective = instance.objective(best_x)
        repaired = True

    return SolverResult(
        solver="simulated_annealing",
        x=best_x,
        objective=float(best_objective),
        feasible=True,
        runtime=time.perf_counter() - start,
        evaluations=evaluations,
        extras={"repaired": repaired, "restarts": restarts, "feasible_visits": feasible_seen},
    )
