"""Continuous mean-variance optimisation: the unconstrained reference frontier."""

from __future__ import annotations

import time

import numpy as np
from scipy.optimize import minimize

from ..config import RISK_FREE_RATE
from ..formulation import PortfolioInstance
from .base import Budget, SolverResult


def _long_only(objective, gradient, n: int, extra: list | None = None) -> np.ndarray:
    constraints = [{"type": "eq", "fun": lambda w: w.sum() - 1, "jac": lambda w: np.ones(n)}] + (extra or [])
    result = minimize(
        objective,
        np.full(n, 1 / n),
        jac=gradient,
        method="SLSQP",
        bounds=[(0.0, 1.0)] * n,
        constraints=constraints,
        options={"maxiter": 500, "ftol": 1e-11},
    )
    weights = np.clip(result.x, 0.0, 1.0)
    return weights / weights.sum()


def scalarised(mu: np.ndarray, sigma: np.ndarray, risk_aversion: float) -> np.ndarray:
    """Equation (2): maximise mu'w - lambda w'Sigma w over the long-only simplex."""
    return _long_only(
        lambda w: risk_aversion * w @ sigma @ w - mu @ w,
        lambda w: 2 * risk_aversion * sigma @ w - mu,
        len(mu),
    )


def efficient_frontier(mu: np.ndarray, sigma: np.ndarray, points: int = 40) -> list[dict]:
    """Minimum variance for a grid of target returns between the GMV portfolio and the top asset."""
    n = len(mu)
    gmv = _long_only(lambda w: w @ sigma @ w, lambda w: 2 * sigma @ w, n)
    low, high = float(mu @ gmv), float(mu.max())
    frontier = []
    for target in np.linspace(low, high, points):
        weights = _long_only(
            lambda w: w @ sigma @ w,
            lambda w: 2 * sigma @ w,
            n,
            [{"type": "ineq", "fun": lambda w, t=target: mu @ w - t, "jac": lambda w: mu}],
        )
        frontier.append(
            {"ret": float(mu @ weights), "vol": float(np.sqrt(weights @ sigma @ weights)), "weights": weights.tolist()}
        )
    return frontier


def max_sharpe(mu: np.ndarray, sigma: np.ndarray, risk_free: float = RISK_FREE_RATE) -> np.ndarray:
    def negative(w: np.ndarray) -> float:
        return -(mu @ w - risk_free) / np.sqrt(w @ sigma @ w)

    return _long_only(negative, None, len(mu))


def solve_mvo(instance: PortfolioInstance, budget: Budget | None = None) -> SolverResult:
    """Scalarised continuous solution on the same mean and covariance. An upper reference only."""
    start = time.perf_counter()
    weights = scalarised(instance.mu, instance.sigma, instance.q)
    order = np.argsort(-weights)[: instance.K]
    x = np.zeros(instance.n, dtype=int)
    x[order] = 1
    return SolverResult(
        solver="mvo",
        x=x,
        objective=float(instance.q * weights @ instance.sigma @ weights - instance.mu @ weights),
        feasible=False,
        runtime=time.perf_counter() - start,
        weights=weights,
        extras={"note": "Continuous weights, so the cardinality limit does not bind on this reference."},
    )
