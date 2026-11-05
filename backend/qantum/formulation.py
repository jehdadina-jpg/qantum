"""Section 6 of the proposal: QUBO construction, penalty terms and the Ising mapping."""

from __future__ import annotations

from dataclasses import dataclass, field, replace
from math import comb

import numpy as np


@dataclass
class PortfolioInstance:
    """Selection-encoded instance. Selected assets are equally weighted, w = x / K."""

    tickers: list[str]
    mu: np.ndarray
    sigma: np.ndarray
    K: int
    q: float = 3.0
    penalty: float = 1.0
    tc: float = 0.0
    holdings: np.ndarray | None = None
    meta: dict = field(default_factory=dict)

    def __post_init__(self) -> None:
        self.mu = np.asarray(self.mu, dtype=float)
        self.sigma = np.asarray(self.sigma, dtype=float)
        if not 1 <= self.K <= self.n:
            raise ValueError(f"Cardinality K={self.K} is outside 1..{self.n}")

    @property
    def n(self) -> int:
        return len(self.mu)

    @property
    def scaled_mu(self) -> np.ndarray:
        return self.mu / self.K

    @property
    def scaled_sigma(self) -> np.ndarray:
        return self.sigma / self.K**2

    @property
    def y(self) -> np.ndarray:
        return np.zeros(self.n) if self.holdings is None else np.asarray(self.holdings, dtype=float)

    def objective(self, x: np.ndarray) -> float:
        """Equation (3) plus the linear transaction-cost term, without the cardinality penalty."""
        x = np.asarray(x, dtype=float)
        return float(
            self.q * x @ self.scaled_sigma @ x - self.scaled_mu @ x + self.tc * np.abs(x - self.y).sum()
        )

    def qubo(self) -> tuple[np.ndarray, float]:
        """Symmetric Q and constant from equation (6), so that f(x) = x'Qx + constant."""
        n, K, P, c = self.n, self.K, self.penalty, self.tc
        Q = self.q * self.scaled_sigma + P * (np.ones((n, n)) - np.eye(n))
        np.fill_diagonal(
            Q,
            self.q * np.diag(self.scaled_sigma) - self.scaled_mu + P * (1 - 2 * K) + c * (1 - 2 * self.y),
        )
        return Q, float(P * K**2 + c * self.y.sum())

    def energy(self, x: np.ndarray) -> float:
        Q, constant = self.qubo()
        x = np.asarray(x, dtype=float)
        return float(x @ Q @ x + constant)


def ising(Q: np.ndarray, constant: float = 0.0) -> tuple[np.ndarray, np.ndarray, float]:
    """Equation (7): x_i = (1 - z_i) / 2 gives H_C = sum h_i Z_i + sum_{i<j} J_ij Z_i Z_j + offset."""
    n = len(Q)
    J = np.triu(Q, 1) / 2
    off_diagonal = Q.sum(axis=1) - np.diag(Q)
    h = -0.5 * (np.diag(Q) + off_diagonal)
    offset = constant + np.diag(Q).sum() / 2 + np.triu(Q, 1).sum() / 2
    assert J.shape == (n, n)
    return h, J, float(offset)


def all_energies(Q: np.ndarray, constant: float = 0.0) -> np.ndarray:
    """f(x) for every bit string in O(2^n) by doubling. Index bit i holds x_i (Qiskit order)."""
    energies = np.zeros(1)
    for i in range(len(Q)):
        linear = np.zeros(1)
        for j in range(i):
            linear = np.concatenate([linear, linear + Q[i, j]])
        energies = np.concatenate([energies, energies + Q[i, i] + 2 * linear])
    return energies + constant


def popcounts(n: int) -> np.ndarray:
    counts = np.zeros(1, dtype=np.int8)
    for _ in range(n):
        counts = np.concatenate([counts, counts + 1])
    return counts


def int_to_bits(index: int, n: int) -> np.ndarray:
    return np.array([(index >> i) & 1 for i in range(n)], dtype=int)


def bits_to_int(x: np.ndarray) -> int:
    return int(sum(int(b) << i for i, b in enumerate(x)))


def bitstring(x: np.ndarray) -> str:
    """Left-to-right in asset order, which is how bit strings are shown in the proposal."""
    return "".join(str(int(b)) for b in x)


def repair(instance: PortfolioInstance, x: np.ndarray) -> np.ndarray:
    """Greedy feasibility repair: drop or add the asset that hurts the objective least."""
    x = np.asarray(x, dtype=int).copy()
    while x.sum() != instance.K:
        best_index, best_value = -1, np.inf
        adding = x.sum() < instance.K
        for i in np.flatnonzero(x == (0 if adding else 1)):
            x[i] = 1 if adding else 0
            value = instance.objective(x)
            x[i] = 0 if adding else 1
            if value < best_value:
                best_index, best_value = int(i), value
        x[best_index] = 1 if adding else 0
    return x


def feasible_objective_range(instance: PortfolioInstance, samples: int = 20000, seed: int = 0) -> tuple[float, float, bool]:
    """(min, max, exact). Exact for tractable search spaces, sampled with a margin otherwise."""
    n, K = instance.n, instance.K
    if comb(n, K) <= 200_000:
        bare = replace(instance, penalty=0.0)
        Q, constant = bare.qubo()
        energies = all_energies(Q, constant)
        feasible = energies[popcounts(n) == K]
        return float(feasible.min()), float(feasible.max()), True
    rng = np.random.default_rng(seed)
    values = []
    for _ in range(samples):
        x = np.zeros(n)
        x[rng.choice(n, K, replace=False)] = 1
        values.append(instance.objective(x))
    low, high = min(values), max(values)
    margin = 0.25 * (high - low)
    return low - margin, high + margin, False


def sufficient_penalty(instance: PortfolioInstance) -> float:
    """P > max f - min f over feasible x, the bound stated in section 6.4."""
    low, high, _ = feasible_objective_range(instance)
    return (high - low) * 1.05 + 1e-9


def minimum_exact_penalty(instance: PortfolioInstance) -> float:
    """Smallest P that keeps the QUBO ground state feasible, found exactly by enumeration.

    For every cardinality m != K the best m-asset string must cost more than the best
    feasible string, which needs P > (f* - f_m) / (m - K)^2.
    """
    Q, constant = replace(instance, penalty=0.0).qubo()
    energies = all_energies(Q, constant)
    counts = popcounts(instance.n)
    optimum = energies[counts == instance.K].min()
    return max(
        (optimum - energies[counts == m].min()) / (m - instance.K) ** 2
        for m in range(instance.n + 1)
        if m != instance.K
    )


def calibrate_penalty(instance: PortfolioInstance, margin: float = 1.2, iterations: int = 6) -> dict:
    """Smallest penalty whose seeded p = 1 state is at least as feasible as uniform sampling.

    Too small a P makes infeasible strings attractive. Too large a P compresses the spread of
    feasible energies, which our measurements on NIFTY 50 instances show degrades QAOA. The
    search therefore starts just above the exact ground-state bound, and bisects toward the
    sufficient bound only if the feasibility rate falls short of the target.
    """
    from .quantum.kernel import QaoaKernel, seed_search

    n, K = instance.n, instance.K
    high = sufficient_penalty(instance)
    target = min(0.95, comb(n, K) / 2**n)
    if n > 20:
        return {"penalty": high, "method": "sufficient-bound", "sufficient_bound": high, "floor": None, "feasibility": None, "target": target}

    floor = minimum_exact_penalty(instance)
    low = max(floor * margin, high * 1e-3)
    feasible_mask = popcounts(n) == K

    def rate(penalty: float) -> float:
        Q, constant = replace(instance, penalty=penalty).qubo()
        kernel = QaoaKernel.from_qubo(Q, constant)
        spread = (kernel.energies[feasible_mask].max() - kernel.energies[feasible_mask].min()) / kernel.scale
        objective = lambda p: kernel.cvar(p, 0.2)  # noqa: E731
        (gamma, beta, _), *_ = seed_search(kernel, objective, 2 * np.pi / max(spread, 1e-6), points=64)
        return float(kernel.probabilities(np.array([gamma]), np.array([beta]))[feasible_mask].sum())

    low_rate = rate(low)
    if low_rate >= target or low >= high:
        return {"penalty": low, "method": "exact-floor", "sufficient_bound": high, "floor": floor, "feasibility": low_rate, "target": target}

    best, best_rate = high, rate(high)
    method = "bisection" if best_rate >= target else "sufficient-bound"
    if method == "bisection":
        lo, hi = low, high
        for _ in range(iterations):
            mid = (lo * hi) ** 0.5
            mid_rate = rate(mid)
            if mid_rate >= target:
                best, best_rate, hi = mid, mid_rate, mid
            else:
                lo = mid
    return {"penalty": best, "method": method, "sufficient_bound": high, "floor": floor, "feasibility": best_rate, "target": target}


@dataclass
class WeightEncoding:
    """Equation (4): each weight expanded in b bits. Extension to the selection model."""

    Q: np.ndarray
    constant: float
    n_assets: int
    bits: int
    budget: int

    def decode(self, x: np.ndarray) -> np.ndarray:
        x = np.asarray(x).reshape(self.n_assets, self.bits)
        return (x * 2 ** np.arange(self.bits)).sum(axis=1) / self.budget


def weight_encoding_qubo(
    mu: np.ndarray, sigma: np.ndarray, bits: int, budget: int, q: float = 3.0, penalty: float = 1.0
) -> WeightEncoding:
    """Quadratic form over n = N * b binary variables, with the budget constraint penalised."""
    mu, sigma = np.asarray(mu), np.asarray(sigma)
    N = len(mu)
    delta = 1 / budget
    powers = 2.0 ** np.arange(bits)
    A = np.kron(np.eye(N), powers) * delta  # w = A x
    total = np.tile(powers, N)  # sum_i sum_k 2^k x_ik
    Q = q * A.T @ sigma @ A + penalty * np.outer(total, total)
    Q[np.diag_indices_from(Q)] += -(A.T @ mu) - 2 * penalty * budget * total
    Q = (Q + Q.T) / 2
    return WeightEncoding(Q=Q, constant=float(penalty * budget**2), n_assets=N, bits=bits, budget=budget)
