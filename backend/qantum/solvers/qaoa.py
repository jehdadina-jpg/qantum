"""QAOA engine: the primary research module.

Execution modes, always labelled in results and never mixed silently:
  statevector  exact amplitudes from the validated kernel
  shots        Qiskit Aer, finite-sample ideal execution inside the optimiser loop
  mps          Qiskit Aer matrix-product-state method, for scaling probes past exact limits
  noise        parameters trained exactly, final sampling on Aer with the noise model
  ibm          parameters trained exactly, final sampling on IBM hardware (needs a token)
"""

from __future__ import annotations

import time
from dataclasses import dataclass, replace
from typing import Callable

import numpy as np
from scipy.optimize import minimize

from ..config import IBM_BACKEND, IBM_TOKEN, MAX_EXACT_QUBITS
from ..formulation import PortfolioInstance, bitstring, feasible_objective_range, ising, popcounts, repair
from ..quantum.kernel import QaoaKernel, distinct_seeds, interpolate_angles, ising_scale, sobol_box
from ..quantum.noise import DEFAULT_NOISE
from .base import Budget, SolverResult

MODES = ("statevector", "shots", "mps", "noise", "ibm")


@dataclass
class QaoaConfig:
    p: int = 3
    mode: str = "statevector"
    objective: str = "cvar"  # "mean" or "cvar"
    alpha: float = 0.2
    optimiser: str = "COBYLA"  # "COBYLA" or "SPSA"
    shots: int = 1024
    maxiter: int = 150
    seed_points: int = 256
    restarts: int = 3
    warm_start: bool = True
    mixer: str = "x"  # "x" or "xy" (exact mode only)
    noise_scale: float = 1.0
    mps_bond: int = 16
    seed: int = 7
    resources: bool = True


def spsa(fun: Callable[[np.ndarray], float], x0: np.ndarray, maxiter: int, seed: int) -> np.ndarray:
    """Simultaneous perturbation stochastic approximation, using two evaluations per step."""
    rng = np.random.default_rng(seed)
    x = x0.copy()
    best_x, best_value = x.copy(), np.inf
    a, c, A = 0.15, 0.1, maxiter * 0.1
    for k in range(max(maxiter // 2, 1)):
        a_k = a / (k + 1 + A) ** 0.602
        c_k = c / (k + 1) ** 0.101
        delta = rng.choice([-1.0, 1.0], size=len(x))
        plus, minus = fun(x + c_k * delta), fun(x - c_k * delta)
        x = x - a_k * (plus - minus) / (2 * c_k) * delta
        if min(plus, minus) < best_value:
            best_value = min(plus, minus)
            best_x = (x + c_k * delta * (1 if plus < minus else -1)).copy()
    return best_x


def _mean_or_cvar(energies: np.ndarray, weights: np.ndarray, objective: str, alpha: float) -> float:
    if objective == "mean":
        return float(energies @ weights / weights.sum())
    order = np.argsort(energies)
    energies, weights = energies[order], weights[order]
    cumulative = np.cumsum(weights) / weights.sum()
    cut = int(np.searchsorted(cumulative, alpha))
    kept = weights[: cut + 1].copy()
    kept[-1] -= max(cumulative[cut] - alpha, 0.0) * weights.sum()
    return float(energies[: cut + 1] @ kept / max(kept.sum(), 1e-15))


def _counts_to_arrays(counts: dict[str, int], n: int) -> tuple[np.ndarray, np.ndarray]:
    """Aer keys read right to left, so reversing gives x_0 first."""
    keys = list(counts)
    bits = np.array([[int(c) for c in key.replace(" ", "")[::-1][:n]] for key in keys], dtype=float)
    return bits, np.array([counts[k] for k in keys], dtype=float)


def sample_on_ibm(circuit, shots: int) -> dict[str, int]:
    """Validation run on IBM hardware. Requires qiskit-ibm-runtime and QANTUM_IBM_TOKEN."""
    if not IBM_TOKEN:
        raise RuntimeError("Set QANTUM_IBM_TOKEN to use the IBM hardware backend")
    from qiskit import transpile
    from qiskit_ibm_runtime import QiskitRuntimeService, SamplerV2

    service = QiskitRuntimeService(channel="ibm_quantum_platform", token=IBM_TOKEN)
    backend = service.backend(IBM_BACKEND) if IBM_BACKEND else service.least_busy(operational=True, simulator=False)
    compiled = transpile(circuit, backend=backend, optimization_level=3)
    job = SamplerV2(mode=backend).run([compiled], shots=shots)
    return job.result()[0].data.meas.get_counts()


def solve_qaoa(
    instance: PortfolioInstance,
    budget: Budget | None = None,
    config: QaoaConfig | None = None,
    ground_truth: float | None = None,
    on_progress: Callable[[dict], None] | None = None,
    include_landscape: bool = False,
) -> SolverResult:
    config = config or QaoaConfig()
    budget = budget or Budget()
    if config.mode not in MODES:
        raise ValueError(f"Unknown execution mode {config.mode!r}")
    if config.mixer == "xy" and config.mode != "statevector":
        raise ValueError("The XY mixer runs on the exact statevector mode only")

    start = time.perf_counter()
    rng = np.random.default_rng(config.seed)
    n = instance.n
    Q, constant = instance.qubo()
    h, J, _ = ising(Q, constant)
    if config.mixer == "xy":
        # The feasible subspace is invariant, so the cardinality penalty is removed entirely.
        Q, constant = replace(instance, penalty=0.0).qubo()
        h, J, _ = ising(Q, constant)

    exact_available = n <= MAX_EXACT_QUBITS
    exact_training = config.mode in ("statevector", "noise", "ibm")
    if (exact_training or config.mode == "shots") and not exact_available:
        raise ValueError(f"Mode {config.mode!r} needs N <= {MAX_EXACT_QUBITS}. Use mps for larger scaling probes.")

    kernel = QaoaKernel.from_qubo(Q, constant, mixer=config.mixer, K=instance.K) if exact_available else None

    # Aer objects are only built for modes that need them, since transpiling is the slow part.
    sim = compiled = None
    from ..quantum.circuits import bind, circuit_resources, gate_list, qaoa_circuit

    if config.mode in ("shots", "mps"):
        from qiskit import transpile
        from qiskit_aer import AerSimulator

        if config.mode == "mps":
            # Dense RZZ layers entangle every pair, so an uncapped bond dimension is exponential.
            # Capping it makes this an approximate simulation, labelled as such in the extras.
            sim = AerSimulator(
                method="matrix_product_state",
                matrix_product_state_max_bond_dimension=config.mps_bond,
                seed_simulator=config.seed,
            )
        else:
            sim = AerSimulator(method="statevector", seed_simulator=config.seed)
        compiled = {
            depth: transpile(qaoa_circuit(h, J, depth), sim, optimization_level=1, seed_transpiler=config.seed)
            for depth in (range(1, config.p + 1) if config.warm_start else [config.p])
        }

    # Gamma is searched over the range that can resolve the spread of feasible energies. The
    # penalty dominates H_C, so this range is far wider than a textbook linear ramp assumes.
    if kernel is not None:
        feasible = kernel.energies[popcounts(n) == instance.K]
        spread = (feasible.max() - feasible.min()) / kernel.scale
    else:
        low, high, _ = feasible_objective_range(instance)
        spread = (high - low) / ising_scale(h, J)
    gamma_max = 2 * np.pi / max(float(spread), 1e-6)
    gamma_unit = gamma_max / (np.pi / 2)  # optimisers see gamma and beta on comparable scales

    trace: list[float] = []
    best_trace: list[float] = []
    best_seen = np.inf
    evaluations = 0

    def evaluate(theta: np.ndarray, depth: int) -> float:
        nonlocal best_seen, evaluations
        gammas, betas = theta[:depth] * gamma_unit, theta[depth:]
        if exact_training:
            probabilities = kernel.probabilities(gammas, betas)
            value = kernel.expectation(probabilities) if config.objective == "mean" else kernel.cvar(probabilities, config.alpha)
        else:
            counts = sim.run(bind(compiled[depth], gammas, betas), shots=config.shots).result().get_counts()
            bits, weights = _counts_to_arrays(counts, n)
            energies = np.einsum("ij,jk,ik->i", bits, Q, bits) + constant
            value = _mean_or_cvar(energies, weights, config.objective, config.alpha)
        evaluations += 1
        trace.append(value)
        best_seen = min(best_seen, value)
        best_trace.append(best_seen)
        if on_progress and evaluations % 5 == 0:
            on_progress({"trace": trace[-400:], "best": best_trace[-400:], "evaluations": evaluations})
        return value

    def optimise(theta0: np.ndarray, depth: int, iterations: int, seed: int) -> tuple[np.ndarray, float]:
        if config.optimiser == "SPSA":
            theta = spsa(lambda t: evaluate(t, depth), theta0, iterations, seed)
            return theta, evaluate(theta, depth)
        result = minimize(
            lambda t: evaluate(t, depth),
            theta0,
            method="COBYLA",
            options={"maxiter": iterations, "rhobeg": 0.05, "tol": 1e-4},
        )
        return result.x, float(result.fun)

    depths = list(range(1, config.p + 1)) if config.warm_start else [config.p]

    def ramp_seed(gamma: float, beta: float, depth: int) -> np.ndarray:
        t = (np.arange(depth) + 0.5) / depth
        return np.concatenate([gamma / gamma_unit * 2 * t, beta * 2 * (1 - t)])

    # Multi-start: each restart begins from a different good region of the seeded search.
    points = config.seed_points if exact_training else min(config.seed_points, 32)
    scored = [
        (float(gamma), float(beta), evaluate(ramp_seed(gamma, beta, depths[0]), depths[0]))
        for gamma, beta in sobol_box(points, gamma_max, config.seed)
    ]
    seeds = distinct_seeds(scored, gamma_max)
    seed_evaluations = evaluations

    best_theta: np.ndarray | None = None
    best_value = np.inf
    per_layer = max(config.maxiter // max(len(depths), 1), 10)
    for restart in range(config.restarts):
        gamma, beta, _ = seeds[restart % len(seeds)]
        theta = ramp_seed(gamma, beta, depths[0])
        value = np.inf
        for depth in depths:
            theta, value = optimise(theta, depth, per_layer, config.seed + restart * 97 + depth)
            if depth != depths[-1]:
                theta = np.concatenate([interpolate_angles(theta[:depth]), interpolate_angles(theta[depth:])])
        if value < best_value:
            best_value, best_theta = value, theta.copy()
        if time.perf_counter() - start > budget.time_limit:
            break

    gammas, betas = best_theta[: config.p] * gamma_unit, best_theta[config.p :]

    # Final sampling at the optimal parameters.
    final_counts: dict[str, int] | None = None
    if config.mode == "noise":
        from qiskit import transpile
        from qiskit_aer import AerSimulator

        from ..quantum.noise import noise_model

        noise_parameters = DEFAULT_NOISE.scaled(config.noise_scale)
        noisy = AerSimulator(noise_model=noise_model(noise_parameters), seed_simulator=config.seed)
        native = transpile(
            qaoa_circuit(h, J, config.p, mixer=config.mixer), basis_gates=["rz", "sx", "x", "cz"], optimization_level=1, seed_transpiler=config.seed
        )
        final_counts = noisy.run(bind(native, gammas, betas), shots=config.shots).result().get_counts()
    elif config.mode == "ibm":
        final_counts = sample_on_ibm(bind(qaoa_circuit(h, J, config.p), gammas, betas), config.shots)
    elif config.mode in ("shots", "mps"):
        final_counts = sim.run(bind(compiled[config.p], gammas, betas), shots=config.shots).result().get_counts()

    exact_probabilities: np.ndarray | None = None
    if final_counts is None:
        exact_probabilities = kernel.probabilities(gammas, betas)
        sampled = rng.multinomial(config.shots, exact_probabilities / exact_probabilities.sum())
        support = np.flatnonzero(sampled)
        bits = ((support[:, None] >> np.arange(n)) & 1).astype(float)
        weights = sampled[support].astype(float)
    else:
        bits, weights = _counts_to_arrays(final_counts, n)

    energies = np.einsum("ij,jk,ik->i", bits, Q, bits) + constant
    is_feasible = bits.sum(axis=1) == instance.K
    probabilities_sampled = weights / weights.sum()

    # Decode: the best feasible sampled string, otherwise repair the most probable strings.
    decoded_from = "best-sampled"
    if is_feasible.any():
        objectives = np.array([instance.objective(b) for b in bits[is_feasible]])
        x = bits[is_feasible][int(np.argmin(objectives))].astype(int)
    else:
        decoded_from = "repaired"
        top = bits[np.argsort(-weights)[:16]].astype(int)
        candidates = [repair(instance, b) for b in top]
        x = min(candidates, key=instance.objective)

    feasibility_rate = float(probabilities_sampled[is_feasible].sum())
    success_probability = None
    approximation = {}
    sampled_mean_energy = float(energies @ probabilities_sampled)

    if kernel is not None:
        mask = popcounts(n) == instance.K
        feasible_energies = kernel.energies[mask]
        f_min_all, f_max_all = float(kernel.energies.min()), float(kernel.energies.max())
        f_min, f_max = float(feasible_energies.min()), float(feasible_energies.max())
        if exact_probabilities is not None:
            distribution_mean = kernel.expectation(exact_probabilities)
            feasibility_rate = float(exact_probabilities[mask].sum())
            optimum_indices = np.flatnonzero(mask & (np.abs(kernel.energies - f_min) < 1e-10))
            success_probability = float(exact_probabilities[optimum_indices].sum())
            conditional = float(exact_probabilities[mask] @ kernel.energies[mask] / max(exact_probabilities[mask].sum(), 1e-15))
        else:
            distribution_mean = sampled_mean_energy
            optimum_key = bitstring(((int(np.flatnonzero(mask)[int(np.argmin(feasible_energies))]) >> np.arange(n)) & 1))
            lookup = {bitstring(b.astype(int)): w for b, w in zip(bits, probabilities_sampled)}
            success_probability = float(lookup.get(optimum_key, 0.0))
            conditional = (
                float(energies[is_feasible] @ probabilities_sampled[is_feasible] / probabilities_sampled[is_feasible].sum())
                if is_feasible.any()
                else f_max
            )
        approximation = {
            "approximation_ratio": (f_max_all - distribution_mean) / max(f_max_all - f_min_all, 1e-15),
            "approximation_ratio_feasible": (f_max - conditional) / max(f_max - f_min, 1e-15),
            "expected_energy": distribution_mean,
            "energy_min": f_min_all,
            "energy_max": f_max_all,
        }

    # Top bit strings for the histogram panel.
    if exact_probabilities is not None:
        top_indices = np.argsort(-exact_probabilities)[:32]
        histogram = [
            {
                "bits": bitstring((int(i) >> np.arange(n)) & 1),
                "probability": float(exact_probabilities[i]),
                "energy": float(kernel.energies[i]),
                "feasible": bool(bin(int(i)).count("1") == instance.K),
            }
            for i in top_indices
        ]
    else:
        order = np.argsort(-probabilities_sampled)[:32]
        histogram = [
            {
                "bits": bitstring(bits[i].astype(int)),
                "probability": float(probabilities_sampled[i]),
                "energy": float(energies[i]),
                "feasible": bool(is_feasible[i]),
            }
            for i in order
        ]

    extras = {
        "mode": config.mode,
        "p": config.p,
        "objective_kind": config.objective,
        "alpha": config.alpha,
        "optimiser": config.optimiser,
        "mixer": config.mixer,
        "shots": config.shots,
        "restarts": config.restarts,
        "gammas": gammas.tolist(),
        "betas": betas.tolist(),
        "trace": trace,
        "best_trace": best_trace,
        "objective_evaluations": evaluations,
        "seed_evaluations": seed_evaluations,
        "gamma_max": gamma_max,
        "energy_evaluations": evaluations * config.shots + config.shots,
        "feasibility_rate": feasibility_rate,
        "success_probability": success_probability,
        "decoded_from": decoded_from,
        "histogram": histogram,
        "sampled_mean_energy": sampled_mean_energy,
        "distinct_strings": int(len(weights)),
        "noise": DEFAULT_NOISE.scaled(config.noise_scale).as_dict() if config.mode == "noise" else None,
        "mps_max_bond": config.mps_bond if config.mode == "mps" else None,
        **approximation,
    }

    if ground_truth is not None:
        extras["ground_truth"] = ground_truth

    if config.resources:
        circuit = qaoa_circuit(h, J, config.p, mixer=config.mixer)
        extras["resources"] = circuit_resources(circuit, DEFAULT_NOISE.scaled(config.noise_scale))
        if n <= 8:
            extras["gates"] = gate_list(qaoa_circuit(h, J, 1, mixer=config.mixer))

    if include_landscape and kernel is not None and config.mixer == "x":
        extras["landscape"] = energy_landscape(kernel, gamma_max, best=seeds[0][:2])

    return SolverResult(
        solver="qaoa",
        x=np.asarray(x, dtype=int),
        objective=instance.objective(x),
        feasible=True,
        runtime=time.perf_counter() - start,
        evaluations=extras["energy_evaluations"],
        extras=extras,
    )


def energy_landscape(kernel: QaoaKernel, gamma_max: float, resolution: int = 48, best: tuple[float, float] | None = None) -> dict:
    """Exact p = 1 landscape <H_C>(gamma, beta), the data behind Figure 7.3."""
    gammas = np.linspace(0, gamma_max, resolution)
    betas = np.linspace(0, np.pi / 2, resolution)
    grid = np.zeros((resolution, resolution))
    for i, beta in enumerate(betas):
        for j, gamma in enumerate(gammas):
            grid[i, j] = kernel.expectation(kernel.probabilities(np.array([gamma]), np.array([beta])))
    index = np.unravel_index(np.argmin(grid), grid.shape)
    return {
        "gammas": gammas.tolist(),
        "betas": betas.tolist(),
        "energy": grid.tolist(),
        "minimum": {"gamma": float(gammas[index[1]]), "beta": float(betas[index[0]]), "energy": float(grid[index])},
        "optimised": {"gamma": best[0], "beta": best[1]} if best else None,
    }


