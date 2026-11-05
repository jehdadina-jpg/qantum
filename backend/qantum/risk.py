"""Module 3 (exploratory): quantum risk engine with Iterative QAE against classical Monte Carlo.

Both estimators target the same discretised loss distribution, so discretisation error is
isolated from estimation error. Ideal query counts, circuit cost and noisy accuracy are
reported as separate quantities and are never merged into one claim.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable, Protocol

import numpy as np
from qiskit import QuantumCircuit, transpile
from qiskit.circuit.library import StatePreparation, UCRYGate, grover_operator
from qiskit.quantum_info import Statevector
from scipy import stats

from .quantum.noise import DEFAULT_NOISE, NoiseParameters, noise_model

BASIS = ["rz", "sx", "x", "cz"]


def simulate_losses(
    weights: np.ndarray,
    mu: np.ndarray,
    sigma: np.ndarray,
    horizon_days: int = 1,
    scenarios: int = 200_000,
    seed: int = 7,
    trading_days: int = 252,
) -> np.ndarray:
    """Equation-(9) scenarios: r = mu dt + L z with Sigma = L L'. Loss is the negative simple return."""
    rng = np.random.default_rng(seed)
    dt = horizon_days / trading_days
    factor = np.linalg.cholesky(sigma * dt + 1e-12 * np.eye(len(mu)))
    drift = (mu - 0.5 * np.diag(sigma)) * dt
    shocks = rng.standard_normal((scenarios, len(mu)))
    log_returns = drift + shocks @ factor.T
    return -(np.expm1(log_returns) @ weights)


@dataclass
class LossDistribution:
    grid: np.ndarray
    probabilities: np.ndarray
    n_qubits: int

    @property
    def low(self) -> float:
        return float(self.grid[0])

    @property
    def high(self) -> float:
        return float(self.grid[-1])

    def cdf(self, index: int) -> float:
        return float(self.probabilities[: index + 1].sum())

    def var_index(self, alpha: float) -> int:
        return int(np.searchsorted(np.cumsum(self.probabilities), alpha - 1e-12))

    def exact(self, alpha: float) -> dict:
        """Equation (8) evaluated on the grid, the reference for both estimators."""
        index = self.var_index(alpha)
        tail = self.probabilities[index:]
        return {
            "var_index": index,
            "var": float(self.grid[index]),
            "cvar": float(self.grid[index:] @ tail / tail.sum()),
            "tail_probability": float(tail.sum()),
            "cdf_at_var": self.cdf(index),
        }


def discretise(losses: np.ndarray, n_qubits: int) -> LossDistribution:
    """Histogram scenario losses onto 2^n bin centres, trimming extreme outliers."""
    low, high = np.quantile(losses, [0.0005, 0.9995])
    edges = np.linspace(low, high, 2**n_qubits + 1)
    counts, _ = np.histogram(np.clip(losses, low, high), bins=edges)
    return LossDistribution(
        grid=(edges[:-1] + edges[1:]) / 2,
        probabilities=counts / counts.sum(),
        n_qubits=n_qubits,
    )


def a_operator(probabilities: np.ndarray, payoff: np.ndarray) -> QuantumCircuit:
    """Equations (12) and (14): load p_i, then rotate the objective qubit by g(i)."""
    n = int(np.log2(len(probabilities)))
    circuit = QuantumCircuit(n + 1, name="A")
    circuit.append(StatePreparation(np.sqrt(probabilities / probabilities.sum())), range(n))
    angles = 2 * np.arcsin(np.sqrt(np.clip(payoff, 0.0, 1.0)))
    circuit.append(UCRYGate([float(a) for a in angles]), [n] + list(range(n)))
    return circuit


def q_operator(a: QuantumCircuit) -> QuantumCircuit:
    """Grover operator Q = A S_0 A-dagger S_psi0, where good states have the objective qubit in |1>."""
    objective = a.num_qubits - 1
    oracle = QuantumCircuit(a.num_qubits)
    oracle.z(objective)
    return grover_operator(oracle, state_preparation=a)


def amplitude(a: QuantumCircuit) -> float:
    return float(Statevector(a).probabilities([a.num_qubits - 1])[1])


class Oracle(Protocol):
    def ones(self, k: int, shots: int, rng: np.random.Generator) -> int: ...


@dataclass
class ExactOracle:
    """Samples P(1) = sin^2((2k + 1) theta) with theta taken from the statevector of the real A circuit."""

    a_value: float

    def ones(self, k: int, shots: int, rng: np.random.Generator) -> int:
        theta = np.arcsin(np.sqrt(self.a_value))
        return int(rng.binomial(shots, np.sin((2 * k + 1) * theta) ** 2))


@dataclass
class AerOracle:
    """Executes A Q^k on Aer, optionally under the noise model. Used for the noisy study."""

    a: QuantumCircuit
    noise: NoiseParameters | None = None
    seed: int = 7
    _sim: object = field(init=False, default=None)
    _q: QuantumCircuit = field(init=False, default=None)
    _cache: dict = field(init=False, default_factory=dict)

    def __post_init__(self) -> None:
        from qiskit_aer import AerSimulator

        self._sim = AerSimulator(noise_model=noise_model(self.noise) if self.noise else None, seed_simulator=self.seed)
        self._q = transpile(q_operator(self.a), basis_gates=BASIS, optimization_level=1, seed_transpiler=self.seed)
        self._a_native = transpile(self.a, basis_gates=BASIS, optimization_level=1, seed_transpiler=self.seed)

    def circuit(self, k: int) -> QuantumCircuit:
        if k not in self._cache:
            circuit = QuantumCircuit(self.a.num_qubits, 1)
            circuit.compose(self._a_native, inplace=True)
            for _ in range(k):
                circuit.compose(self._q, inplace=True)
            circuit.measure(self.a.num_qubits - 1, 0)
            self._cache[k] = circuit
        return self._cache[k]

    def ones(self, k: int, shots: int, rng: np.random.Generator) -> int:
        counts = self._sim.run(self.circuit(k), shots=shots, seed_simulator=int(rng.integers(2**31))).result().get_counts()
        return int(counts.get("1", 0))


def _next_power(k: int, upper: bool, interval: tuple[float, float], min_ratio: float = 2.0) -> tuple[int, bool]:
    """FindNextK from Grinko et al.: largest usable Grover power whose scaled interval fits a half-plane."""
    low, high = interval
    previous = 4 * k + 2
    largest = int(1 / (2 * (high - low)))
    scaling = largest - (largest - 2) % 4
    while scaling >= min_ratio * previous:
        scaled_low = scaling * low - int(scaling * low)
        scaled_high = scaling * high - int(scaling * high)
        if scaled_low <= scaled_high <= 0.5 and scaled_low <= 0.5:
            return int((scaling - 2) / 4), True
        if scaled_high >= 0.5 and scaled_high >= scaled_low >= 0.5:
            return int((scaling - 2) / 4), False
        scaling -= 4
    return k, upper


def iterative_qae(
    oracle: Oracle,
    epsilon: float = 0.01,
    confidence: float = 0.05,
    shots: int = 100,
    seed: int = 7,
    max_power: int | None = None,
    max_rounds: int = 60,
) -> dict:
    """Iterative QAE [23] with Clopper-Pearson intervals. Angles are in units of 2*pi, as in the paper."""
    rng = np.random.default_rng(seed)
    interval = (0.0, 0.25)
    planned_rounds = int(np.log(2.0 * np.pi / 8 / epsilon) / np.log(2.0)) + 1
    level = confidence / max(planned_rounds, 1)
    k, upper = 0, True
    powers, records = [], []
    queries_a = queries_q = 0
    round_ones = round_shots = 0
    rounds = 0
    stalled = False

    while interval[1] - interval[0] > epsilon / np.pi and rounds < max_rounds:
        rounds += 1
        next_k, next_upper = _next_power(k, upper, interval)
        if max_power is not None and next_k > max_power:
            next_k, next_upper = k, upper
        if next_k != k or not powers:
            round_ones = round_shots = 0
        k, upper = next_k, next_upper
        ones = oracle.ones(k, shots, rng)
        round_ones += ones
        round_shots += shots
        queries_a += shots * (2 * k + 1)
        queries_q += shots * k
        powers.append(k)

        low_p = 0.0 if round_ones == 0 else stats.beta.ppf(level / 2, round_ones, round_shots - round_ones + 1)
        high_p = 1.0 if round_ones == round_shots else stats.beta.ppf(1 - level / 2, round_ones + 1, round_shots - round_ones)

        if upper:
            theta_low = np.arccos(1 - 2 * low_p) / (2 * np.pi)
            theta_high = np.arccos(1 - 2 * high_p) / (2 * np.pi)
        else:
            theta_low = 1 - np.arccos(1 - 2 * high_p) / (2 * np.pi)
            theta_high = 1 - np.arccos(1 - 2 * low_p) / (2 * np.pi)

        scaling = 4 * k + 2
        new_low = (int(scaling * interval[0]) + theta_low) / scaling
        new_high = (int(scaling * interval[0]) + theta_high) / scaling
        new_low, new_high = max(new_low, interval[0]), min(new_high, interval[1])
        if new_low >= new_high:
            # Only possible when the samples contradict the ideal model, for example under noise.
            stalled = True
            break
        interval = (new_low, new_high)
        records.append({"k": k, "ones": ones, "shots": shots, "theta_low": new_low, "theta_high": new_high})

        if max_power is not None and k >= max_power and round_shots >= shots * 12:
            break

    a_low = float(np.sin(2 * np.pi * interval[0]) ** 2)
    a_high = float(np.sin(2 * np.pi * interval[1]) ** 2)
    return {
        "estimate": (a_low + a_high) / 2,
        "ci": [a_low, a_high],
        "queries": queries_a,
        "grover_applications": queries_q,
        "max_power": max(powers) if powers else 0,
        "rounds": rounds,
        "powers": powers,
        "stalled": stalled,
    }


def _exact_run(probabilities: np.ndarray, payoff: np.ndarray, epsilon: float, shots: int, seed: int) -> dict:
    """IQAE on the amplitude of the real circuit. Building the circuit once per target keeps it honest."""
    a = a_operator(probabilities, payoff)
    return iterative_qae(ExactOracle(amplitude(a)), epsilon=epsilon, shots=shots, seed=seed)


def qae_risk(dist: LossDistribution, alpha: float, epsilon: float = 0.005, shots: int = 100, seed: int = 7) -> dict:
    """VaR by bisection over the grid, then CVaR as a normalised payoff over the tail."""
    size = len(dist.grid)
    probabilities = dist.probabilities
    low, high = 0, size - 1
    total_queries = 0
    bisection = []
    step = 0
    while low < high:
        mid = (low + high) // 2
        indicator = (np.arange(size) <= mid).astype(float)
        run = _exact_run(probabilities, indicator, epsilon, shots, seed + step)
        total_queries += run["queries"]
        bisection.append({"index": mid, "loss": float(dist.grid[mid]), "cdf": run["estimate"], "queries": run["queries"]})
        if run["estimate"] >= alpha:
            high = mid
        else:
            low = mid + 1
        step += 1
    var_index = low

    span = dist.high - dist.low
    tail_indicator = (np.arange(size) >= var_index).astype(float)
    tail_payoff = tail_indicator * (dist.grid - dist.low) / span
    tail = _exact_run(probabilities, tail_indicator, epsilon, shots, seed + 1000)
    payoff = _exact_run(probabilities, tail_payoff, epsilon, shots, seed + 2000)
    total_queries += tail["queries"] + payoff["queries"]
    cvar = dist.low + span * payoff["estimate"] / max(tail["estimate"], 1e-12)

    return {
        "var": float(dist.grid[var_index]),
        "var_index": var_index,
        "cvar": float(cvar),
        "queries": int(total_queries),
        "bisection": bisection,
        "tail_probability": tail["estimate"],
        "epsilon": epsilon,
    }


def monte_carlo_risk(dist: LossDistribution, alpha: float, samples: int, seed: int = 7) -> dict:
    """Classical Monte Carlo on the same grid, with the same number of samples as QAE queries."""
    rng = np.random.default_rng(seed)
    counts = rng.multinomial(samples, dist.probabilities)
    frequency = counts / samples
    index = int(np.searchsorted(np.cumsum(frequency), alpha - 1e-12))
    index = min(index, len(dist.grid) - 1)
    tail = frequency[index:]
    return {
        "var": float(dist.grid[index]),
        "var_index": index,
        "cvar": float(dist.grid[index:] @ tail / max(tail.sum(), 1e-12)),
        "queries": samples,
    }


def _slope(queries: list[float], errors: list[float]) -> float | None:
    points = [(q, e) for q, e in zip(queries, errors) if q > 0 and e > 0]
    if len(points) < 3:
        return None
    x, y = np.log10([p[0] for p in points]), np.log10([p[1] for p in points])
    return float(np.polyfit(x, y, 1)[0])


def error_scaling_study(
    dist: LossDistribution,
    alpha: float,
    epsilons: tuple[float, ...] = (0.05, 0.02, 0.01, 0.005, 0.002, 0.001, 0.0005, 0.0002),
    repeats: int = 24,
    shots: int = 100,
    seed: int = 7,
    on_progress: Callable[[float], None] | None = None,
) -> dict:
    """Measured error against queries for the loss probability at the VaR grid point (RQ4)."""
    index = dist.var_index(alpha)
    truth = dist.cdf(index)
    indicator = (np.arange(len(dist.grid)) <= index).astype(float)
    a = a_operator(dist.probabilities, indicator)
    a_value = amplitude(a)
    rows = []
    for step, epsilon in enumerate(epsilons):
        qae_errors, qae_queries, powers = [], [], []
        for r in range(repeats):
            run = iterative_qae(ExactOracle(a_value), epsilon=epsilon, shots=shots, seed=seed + 31 * r + step)
            qae_errors.append(abs(run["estimate"] - truth))
            qae_queries.append(run["queries"])
            powers.append(run["max_power"])
        budget = int(np.median(qae_queries))
        rng = np.random.default_rng(seed + 7919 * step)
        mc_errors = np.abs(rng.binomial(budget, truth, size=max(repeats * 8, 200)) / budget - truth)
        rows.append(
            {
                "epsilon": epsilon,
                "queries": budget,
                "qae_error": float(np.median(qae_errors)),
                "qae_q1": float(np.quantile(qae_errors, 0.25)),
                "qae_q3": float(np.quantile(qae_errors, 0.75)),
                "mc_error": float(np.median(mc_errors)),
                "mc_q1": float(np.quantile(mc_errors, 0.25)),
                "mc_q3": float(np.quantile(mc_errors, 0.75)),
                "max_power": int(np.max(powers)),
            }
        )
        if on_progress:
            on_progress((step + 1) / len(epsilons))
    return {
        "target": "P(L <= VaR grid point)",
        "truth": truth,
        "repeats": repeats,
        "rows": rows,
        "qae_slope": _slope([r["queries"] for r in rows], [r["qae_error"] for r in rows]),
        "mc_slope": _slope([r["queries"] for r in rows], [r["mc_error"] for r in rows]),
    }


def circuit_cost(probabilities: np.ndarray, payoff: np.ndarray, powers: tuple[int, ...] = (0, 1, 2, 4, 8)) -> dict:
    """End-to-end gate counts per oracle call and per Grover power, separate from query counts."""
    a = a_operator(probabilities, payoff)
    native_a = transpile(a, basis_gates=BASIS, optimization_level=1, seed_transpiler=3)
    native_q = transpile(q_operator(a), basis_gates=BASIS, optimization_level=1, seed_transpiler=3)

    def counts(circuit: QuantumCircuit) -> dict:
        return {
            "depth": circuit.depth(),
            "two_qubit": sum(1 for inst in circuit.data if inst.operation.num_qubits == 2),
            "one_qubit": sum(1 for inst in circuit.data if inst.operation.num_qubits == 1),
        }

    a_counts, q_counts = counts(native_a), counts(native_q)
    return {
        "qubits": a.num_qubits,
        "a": a_counts,
        "q": q_counts,
        "powers": [
            {
                "k": k,
                "depth_upper_bound": a_counts["depth"] + k * q_counts["depth"],
                "two_qubit": a_counts["two_qubit"] + k * q_counts["two_qubit"],
            }
            for k in powers
        ],
    }


def noise_study(
    dist: LossDistribution,
    alpha: float,
    powers: tuple[int, ...] = (0, 1, 2, 3, 4, 6, 8),
    shots: int = 2000,
    noise: NoiseParameters = DEFAULT_NOISE,
    seed: int = 7,
) -> dict:
    """Ideal against noisy P(1) as Grover power grows, then a capped noisy IQAE run (RQ4, RQ5)."""
    size = len(dist.grid)
    index = dist.var_index(alpha)
    indicator = (np.arange(size) <= index).astype(float)
    a = a_operator(dist.probabilities, indicator)
    a_value = amplitude(a)
    theta = np.arcsin(np.sqrt(a_value))
    oracle = AerOracle(a, noise=noise, seed=seed)
    rng = np.random.default_rng(seed)
    rows = []
    for k in powers:
        circuit = oracle.circuit(k)
        noisy = oracle.ones(k, shots, rng) / shots
        ideal = float(np.sin((2 * k + 1) * theta) ** 2)
        rows.append(
            {
                "k": k,
                "ideal": ideal,
                "noisy": noisy,
                "deviation": abs(ideal - noisy),
                "depth": circuit.depth(),
                "two_qubit": sum(1 for inst in circuit.data if inst.operation.num_qubits == 2),
            }
        )
    capped = iterative_qae(oracle, epsilon=0.01, shots=200, seed=seed, max_power=max(powers), max_rounds=20)
    ideal_run = iterative_qae(ExactOracle(a_value), epsilon=0.01, shots=200, seed=seed)
    return {
        "n_qubits": dist.n_qubits,
        "truth": a_value,
        "noise": noise.as_dict(),
        "rows": rows,
        "noisy_iqae": {**capped, "error": abs(capped["estimate"] - a_value)},
        "ideal_iqae": {**ideal_run, "error": abs(ideal_run["estimate"] - a_value)},
    }


def run_risk_analysis(
    weights: np.ndarray,
    mu: np.ndarray,
    sigma: np.ndarray,
    alpha: float = 0.95,
    horizon_days: int = 1,
    n_qubits: int = 5,
    epsilon: float = 0.005,
    shots: int = 100,
    scenarios: int = 200_000,
    seed: int = 7,
    include_noise: bool = True,
    noise_scale: float = 1.0,
    on_progress: Callable[[float, str], None] | None = None,
) -> dict:
    report = on_progress or (lambda fraction, message: None)
    report(0.05, "Generating loss scenarios")
    losses = simulate_losses(weights, mu, sigma, horizon_days, scenarios, seed)
    continuous_var = float(np.quantile(losses, alpha))
    continuous_cvar = float(losses[losses >= continuous_var].mean())
    dist = discretise(losses, n_qubits)
    exact = dist.exact(alpha)

    report(0.15, "Running Iterative QAE by bisection")
    quantum = qae_risk(dist, alpha, epsilon=epsilon, shots=shots, seed=seed)

    report(0.4, "Running Monte Carlo at the matched budget")
    mc_runs = [monte_carlo_risk(dist, alpha, quantum["queries"], seed=seed + i) for i in range(64)]
    classical = {
        "var": float(np.median([r["var"] for r in mc_runs])),
        "cvar": float(np.median([r["cvar"] for r in mc_runs])),
        "var_error": float(np.median([abs(r["var"] - exact["var"]) for r in mc_runs])),
        "cvar_error": float(np.median([abs(r["cvar"] - exact["cvar"]) for r in mc_runs])),
        "queries": quantum["queries"],
        "repeats": len(mc_runs),
    }

    report(0.5, "Measuring error against queries")
    study = error_scaling_study(
        dist, alpha, shots=shots, seed=seed, on_progress=lambda f: report(0.5 + 0.25 * f, "Measuring error against queries")
    )

    indicator = (np.arange(len(dist.grid)) <= exact["var_index"]).astype(float)
    cost = circuit_cost(dist.probabilities, indicator)

    noisy = None
    if include_noise:
        report(0.8, "Running the noise study on Aer")
        small = discretise(losses, 3)
        noisy = noise_study(small, alpha, noise=DEFAULT_NOISE.scaled(noise_scale), seed=seed)

    report(1.0, "Done")
    return {
        "alpha": alpha,
        "horizon_days": horizon_days,
        "n_qubits": n_qubits,
        "scenarios": scenarios,
        "histogram": {"grid": dist.grid.tolist(), "probabilities": dist.probabilities.tolist()},
        "continuous": {"var": continuous_var, "cvar": continuous_cvar},
        "exact_discrete": exact,
        "discretisation_error": {"var": abs(exact["var"] - continuous_var), "cvar": abs(exact["cvar"] - continuous_cvar)},
        "qae": {
            **quantum,
            "var_error": abs(quantum["var"] - exact["var"]),
            "cvar_error": abs(quantum["cvar"] - exact["cvar"]),
        },
        "monte_carlo": classical,
        "scaling": study,
        "circuit_cost": cost,
        "noise_study": noisy,
    }
