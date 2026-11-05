"""Financial and solution-quality metrics from section 11.3 of the proposal."""

from __future__ import annotations

import numpy as np

from .config import RISK_FREE_RATE, TRADING_DAYS


def optimality_gap(objective: float, optimum: float) -> float:
    return (objective - optimum) / max(abs(optimum), 1e-12)


def max_drawdown(nav: np.ndarray) -> float:
    peak = np.maximum.accumulate(nav)
    return float(((peak - nav) / peak).max())


def path_metrics(simple_returns: np.ndarray, risk_free: float = RISK_FREE_RATE, alpha: float = 0.95) -> dict:
    """Realised, annualised statistics of a daily simple-return series."""
    if len(simple_returns) == 0:
        return {}
    nav = np.cumprod(1 + simple_returns)
    years = len(simple_returns) / TRADING_DAYS
    annual_return = float(nav[-1] ** (1 / years) - 1)
    volatility = float(simple_returns.std(ddof=1) * np.sqrt(TRADING_DAYS)) if len(simple_returns) > 1 else 0.0
    losses = -simple_returns
    var = float(np.quantile(losses, alpha))
    tail = losses[losses >= var]
    return {
        "return": annual_return,
        "volatility": volatility,
        "sharpe": (annual_return - risk_free) / volatility if volatility else None,
        "max_drawdown": max_drawdown(np.concatenate([[1.0], nav])),
        "var": var,
        "cvar": float(tail.mean()) if len(tail) else var,
        "total_return": float(nav[-1] - 1),
    }


def ex_ante(weights: np.ndarray, mu: np.ndarray, sigma: np.ndarray, risk_free: float = RISK_FREE_RATE) -> dict:
    expected = float(mu @ weights)
    volatility = float(np.sqrt(weights @ sigma @ weights))
    return {
        "expected_return": expected,
        "volatility": volatility,
        "sharpe": (expected - risk_free) / volatility if volatility else None,
    }
