"""Module 4 (exploratory): classical scenario generation, stress regimes and QAE on payoffs."""

from __future__ import annotations

from typing import Callable

import numpy as np

from .config import TRADING_DAYS
from .risk import ExactOracle, a_operator, amplitude, iterative_qae

REGIMES = {
    "baseline": {"label": "Baseline", "vol_scale": 1.0, "corr_push": 0.0, "drift_shift": 0.0},
    "elevated": {"label": "Elevated volatility", "vol_scale": 1.5, "corr_push": 0.2, "drift_shift": -0.05},
    "correlation": {"label": "Correlation spike", "vol_scale": 1.3, "corr_push": 0.7, "drift_shift": -0.1},
    "crisis": {"label": "Crisis", "vol_scale": 2.5, "corr_push": 0.8, "drift_shift": -0.4},
}


def stressed(mu: np.ndarray, sigma: np.ndarray, regime: dict) -> tuple[np.ndarray, np.ndarray]:
    """Scale volatilities and push correlations toward one, as described in section 5.4."""
    vol = np.sqrt(np.diag(sigma))
    corr = sigma / np.outer(vol, vol)
    n = len(mu)
    pushed = (1 - regime["corr_push"]) * corr + regime["corr_push"] * np.ones((n, n))
    new_vol = vol * regime["vol_scale"]
    return mu + regime["drift_shift"], pushed * np.outer(new_vol, new_vol)


def gbm_paths(mu: np.ndarray, sigma: np.ndarray, steps: int, paths: int, rng: np.random.Generator) -> np.ndarray:
    """Correlated daily log returns by Cholesky factorisation, shape (paths, steps, assets)."""
    dt = 1 / TRADING_DAYS
    factor = np.linalg.cholesky(sigma * dt + 1e-12 * np.eye(len(mu)))
    drift = (mu - 0.5 * np.diag(sigma)) * dt
    return drift + rng.standard_normal((paths, steps, len(mu))) @ factor.T


def bootstrap_paths(history: np.ndarray, steps: int, paths: int, rng: np.random.Generator, vol_scale: float = 1.0, block: int = 5) -> np.ndarray:
    """Stationary-style block bootstrap of joint historical days. Preserves cross-sectional dependence."""
    length = len(history)
    blocks = int(np.ceil(steps / block))
    starts = rng.integers(0, length - block, size=(paths, blocks))
    offsets = np.arange(block)
    index = (starts[..., None] + offsets).reshape(paths, -1)[:, :steps]
    sample = history[index]
    if vol_scale != 1.0:
        mean = history.mean(axis=0)
        sample = mean + (sample - mean) * vol_scale
    return sample


def portfolio_nav(log_returns: np.ndarray, weights: np.ndarray) -> np.ndarray:
    """Buy-and-hold NAV for each path. Shape (paths, steps + 1)."""
    growth = np.cumprod(np.exp(log_returns), axis=1)
    nav = growth @ weights
    return np.concatenate([np.ones((len(nav), 1)), nav], axis=1)


def summarise(nav: np.ndarray, alpha: float = 0.95) -> dict:
    terminal = nav[:, -1]
    losses = 1 - terminal
    var = float(np.quantile(losses, alpha))
    peak = np.maximum.accumulate(nav, axis=1)
    drawdown = ((peak - nav) / peak).max(axis=1)
    return {
        "mean_return": float(terminal.mean() - 1),
        "median_return": float(np.median(terminal) - 1),
        "volatility": float(terminal.std()),
        "probability_of_loss": float((terminal < 1).mean()),
        "var": var,
        "cvar": float(losses[losses >= var].mean()),
        "mean_max_drawdown": float(drawdown.mean()),
        "worst_max_drawdown": float(np.quantile(drawdown, 0.99)),
    }


def payoff_estimation(terminal: np.ndarray, strike: float = 1.0, n_qubits: int = 5, epsilon: float = 0.005, shots: int = 100, seed: int = 7) -> dict:
    """Expected call-style payoff on portfolio value, by IQAE and by Monte Carlo at matched budget."""
    low, high = np.quantile(terminal, [0.001, 0.999])
    edges = np.linspace(low, high, 2**n_qubits + 1)
    counts, _ = np.histogram(np.clip(terminal, low, high), bins=edges)
    probabilities = counts / counts.sum()
    grid = (edges[:-1] + edges[1:]) / 2
    raw_payoff = np.maximum(grid - strike, 0.0)
    span = max(float(raw_payoff.max()), 1e-9)
    normalised = raw_payoff / span
    truth = float(probabilities @ raw_payoff)
    a = a_operator(probabilities, normalised)
    run = iterative_qae(ExactOracle(amplitude(a)), epsilon=epsilon, shots=shots, seed=seed)
    rng = np.random.default_rng(seed)
    estimates = [
        float(raw_payoff[rng.choice(len(grid), size=run["queries"], p=probabilities)].mean())
        for _ in range(32)
    ]
    return {
        "strike": strike,
        "n_qubits": n_qubits,
        "exact_discrete": truth,
        "qae": run["estimate"] * span,
        "qae_error": abs(run["estimate"] * span - truth),
        "qae_queries": run["queries"],
        "mc_median": float(np.median(estimates)),
        "mc_error": float(np.median(np.abs(np.array(estimates) - truth))),
        "mc_samples": run["queries"],
    }


def run_market_simulation(
    tickers: list[str],
    mu: np.ndarray,
    sigma: np.ndarray,
    history: np.ndarray,
    portfolios: dict[str, np.ndarray],
    horizon_days: int = 63,
    paths: int = 4000,
    model: str = "gbm",
    alpha: float = 0.95,
    seed: int = 7,
    on_progress: Callable[[float, str], None] | None = None,
) -> dict:
    report = on_progress or (lambda fraction, message: None)
    results = {}
    payoff = None
    total = len(REGIMES) * len(portfolios)
    done = 0
    for key, regime in REGIMES.items():
        rng = np.random.default_rng(seed)
        mu_s, sigma_s = stressed(mu, sigma, regime)
        if model == "bootstrap":
            shift = regime["drift_shift"] / TRADING_DAYS
            log_returns = bootstrap_paths(history, horizon_days, paths, rng, vol_scale=regime["vol_scale"]) + shift
        else:
            log_returns = gbm_paths(mu_s, sigma_s, horizon_days, paths, rng)
        by_portfolio = {}
        for name, weights in portfolios.items():
            nav = portfolio_nav(log_returns, weights)
            percentiles = np.quantile(nav, [0.05, 0.25, 0.5, 0.75, 0.95], axis=0)
            histogram, edges = np.histogram(nav[:, -1] - 1, bins=48)
            by_portfolio[name] = {
                **summarise(nav, alpha),
                "fan": {
                    "p05": percentiles[0].tolist(),
                    "p25": percentiles[1].tolist(),
                    "p50": percentiles[2].tolist(),
                    "p75": percentiles[3].tolist(),
                    "p95": percentiles[4].tolist(),
                },
                "samples": nav[: 24].tolist(),
                "terminal": {"counts": histogram.tolist(), "edges": edges.tolist()},
            }
            done += 1
            report(done / total * 0.9, f"{regime['label']}: {name}")
            if key == "baseline" and payoff is None:
                payoff = payoff_estimation(nav[:, -1], seed=seed)
                payoff["portfolio"] = name
        results[key] = {"label": regime["label"], "parameters": regime, "portfolios": by_portfolio}
    report(1.0, "Done")
    return {
        "tickers": tickers,
        "model": model,
        "horizon_days": horizon_days,
        "paths": paths,
        "alpha": alpha,
        "regimes": results,
        "portfolio_weights": {name: weights.tolist() for name, weights in portfolios.items()},
        "payoff": payoff,
    }
