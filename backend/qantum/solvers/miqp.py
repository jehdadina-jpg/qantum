"""Exact MIQP by branch and bound with rigorous convex lower bounds.

Each node solves the continuous relaxation with SLSQP. The relaxed solution is never trusted
as a bound on its own: the Frank-Wolfe dual gap turns it into a valid lower bound for the
convex objective, so a closed tree is a certificate even if SLSQP stops slightly early.
Binary variables satisfy x_i^2 = x_i, so the smallest eigenvalue of the risk matrix can be
moved from the diagonal to the linear term, which tightens the relaxation without changing
the value of any binary point.
"""

from __future__ import annotations

import heapq
import itertools
import time

import numpy as np
from scipy.optimize import minimize

from ..formulation import PortfolioInstance, repair
from .base import Budget, SolverResult

TOLERANCE = 1e-9


def solve_miqp(instance: PortfolioInstance, budget: Budget | None = None) -> SolverResult:
    budget = budget or Budget()
    start = time.perf_counter()
    n, K = instance.n, instance.K
    A = instance.q * instance.scaled_sigma
    linear = -instance.scaled_mu + instance.tc * (1 - 2 * instance.y)
    shift = max(float(np.linalg.eigvalsh(A).min()) * 0.999, 0.0)
    A_tight = A - shift * np.eye(n)
    linear_tight = linear + shift
    constant = instance.tc * float(instance.y.sum())

    def value(x: np.ndarray) -> float:
        return float(x @ A @ x + linear @ x + constant)

    def relax(fixed_one: list[int], free: list[int]) -> tuple[float, np.ndarray] | None:
        """Lower bound and relaxed point for a node, or None if the node is infeasible."""
        remaining = K - len(fixed_one)
        if remaining < 0 or remaining > len(free):
            return None
        base = np.zeros(n)
        base[fixed_one] = 1.0
        if not free or remaining == 0 or remaining == len(free):
            x = base.copy()
            x[free] = 1.0 if free and remaining == len(free) else 0.0
            return float(x @ A_tight @ x + linear_tight @ x + constant), x

        free_index = np.array(free)
        A_ff = A_tight[np.ix_(free_index, free_index)]
        c_f = linear_tight[free_index] + 2 * A_tight[free_index] @ base

        def fun(z: np.ndarray) -> float:
            return float(z @ A_ff @ z + c_f @ z)

        def grad(z: np.ndarray) -> np.ndarray:
            return 2 * A_ff @ z + c_f

        z0 = np.full(len(free), remaining / len(free))
        solution = minimize(
            fun,
            z0,
            jac=grad,
            method="SLSQP",
            bounds=[(0.0, 1.0)] * len(free),
            constraints={"type": "eq", "fun": lambda z: z.sum() - remaining, "jac": lambda z: np.ones(len(z))},
            options={"maxiter": 200, "ftol": 1e-12},
        )
        z = np.clip(solution.x, 0.0, 1.0)
        # Frank-Wolfe dual bound: f(z) + min_v grad'(v - z), minimised by the `remaining` smallest gradients.
        gradient = grad(z)
        vertex = np.zeros(len(free))
        vertex[np.argsort(gradient)[:remaining]] = 1.0
        bound = fun(z) + float(gradient @ (vertex - z))
        x = base.copy()
        x[free_index] = z
        return bound + float(base @ A_tight @ base + linear_tight @ base) + constant, x

    incumbent: np.ndarray | None = None
    incumbent_value = np.inf
    counter = itertools.count()
    nodes = 0
    root = relax([], list(range(n)))
    heap: list = [(root[0], next(counter), [], list(range(n)), root[1])] if root else []
    best_bound = root[0] if root else np.inf
    timed_out = False

    while heap:
        if time.perf_counter() - start > budget.time_limit:
            timed_out = True
            break
        bound, _, fixed_one, free, relaxed = heapq.heappop(heap)
        best_bound = bound
        if bound >= incumbent_value - TOLERANCE:
            best_bound = incumbent_value
            heap.clear()
            break
        nodes += 1

        # Rounding the K largest relaxed values gives a feasible incumbent at every node.
        rounded = np.zeros(n, dtype=int)
        rounded[np.argsort(-relaxed)[:K]] = 1
        rounded_value = value(rounded)
        if rounded_value < incumbent_value:
            incumbent, incumbent_value = rounded, rounded_value

        fractional = np.abs(relaxed[free] - 0.5) if free else np.array([])
        if not free or fractional.min() > 0.5 - 1e-7:
            continue
        pivot = free[int(np.argmin(fractional))]
        rest = [i for i in free if i != pivot]
        for children_fixed in (fixed_one + [pivot], fixed_one):
            child = relax(children_fixed, rest)
            if child and child[0] < incumbent_value - TOLERANCE:
                heapq.heappush(heap, (child[0], next(counter), children_fixed, rest, child[1]))

    if incumbent is None:
        incumbent = repair(instance, np.zeros(n, dtype=int))
        incumbent_value = value(incumbent)

    if not heap and not timed_out:
        best_bound = incumbent_value
    gap = abs(incumbent_value - best_bound) / max(abs(incumbent_value), 1e-12)
    return SolverResult(
        solver="miqp",
        x=incumbent,
        objective=instance.objective(incumbent),
        feasible=True,
        runtime=time.perf_counter() - start,
        evaluations=nodes,
        certified=not timed_out,
        extras={"nodes": nodes, "lower_bound": float(best_bound), "mip_gap": float(gap), "timed_out": timed_out},
    )
