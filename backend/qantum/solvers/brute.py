"""Exhaustive enumeration over all K-subsets: the ground truth for small instances."""

from __future__ import annotations

import time
from dataclasses import replace

import numpy as np

from ..formulation import PortfolioInstance, all_energies, int_to_bits, popcounts
from .base import Budget, SolverResult

MAX_ASSETS = 24


def solve_brute_force(instance: PortfolioInstance, budget: Budget | None = None) -> SolverResult:
    if instance.n > MAX_ASSETS:
        raise ValueError(f"Brute force is limited to N <= {MAX_ASSETS}, got N = {instance.n}")
    start = time.perf_counter()
    Q, constant = replace(instance, penalty=0.0).qubo()
    energies = all_energies(Q, constant)
    feasible = np.flatnonzero(popcounts(instance.n) == instance.K)
    best = int(feasible[np.argmin(energies[feasible])])
    x = int_to_bits(best, instance.n)
    return SolverResult(
        solver="brute_force",
        x=x,
        objective=instance.objective(x),
        feasible=True,
        runtime=time.perf_counter() - start,
        evaluations=len(feasible),
        certified=True,
        extras={"objective_max": float(energies[feasible].max())},
    )
