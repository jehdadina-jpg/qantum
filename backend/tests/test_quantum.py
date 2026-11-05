"""Validation of quantum components against exact references, as the methodology requires."""

import numpy as np
import pytest
from qiskit.quantum_info import Statevector

from qantum.formulation import PortfolioInstance, ising
from qantum.quantum.circuits import bind, circuit_resources, gate_list, qaoa_circuit
from qantum.quantum.kernel import QaoaKernel
from qantum.risk import (
    AerOracle,
    ExactOracle,
    LossDistribution,
    a_operator,
    amplitude,
    discretise,
    error_scaling_study,
    iterative_qae,
    monte_carlo_risk,
    q_operator,
    qae_risk,
    simulate_losses,
)


def small_instance(n=5, K=2, seed=3):
    rng = np.random.default_rng(seed)
    A = rng.normal(size=(n, n + 3))
    return PortfolioInstance([f"A{i}" for i in range(n)], rng.normal(0.1, 0.1, n), A @ A.T * 0.02, K=K, penalty=0.4)


@pytest.mark.parametrize("p", [1, 2, 3])
def test_kernel_matches_qiskit_statevector(p):
    instance = small_instance()
    Q, constant = instance.qubo()
    h, J, _ = ising(Q, constant)
    kernel = QaoaKernel.from_qubo(Q, constant)
    rng = np.random.default_rng(p)
    gammas, betas = rng.uniform(0, 2, p), rng.uniform(0, 1.5, p)
    ours = kernel.state(gammas, betas)
    circuit = bind(qaoa_circuit(h, J, p, measure=False), gammas, betas)
    theirs = np.asarray(Statevector(circuit))
    overlap = abs(np.vdot(ours, theirs))
    assert overlap == pytest.approx(1.0, abs=1e-9)


def test_xy_kernel_matches_qiskit_on_the_feasible_subspace():
    instance = small_instance(n=4, K=2)
    instance.penalty = 0.0
    Q, constant = instance.qubo()
    h, J, _ = ising(Q, constant)
    kernel = QaoaKernel.from_qubo(Q, constant, mixer="xy", K=2)
    gammas, betas = np.array([0.7]), np.array([0.4])
    initial = kernel.initial_state()
    circuit = qaoa_circuit(h, J, 1, mixer="xy", measure=False)
    # Drop the Hadamards and evolve the Dicke state through the same layer.
    body = circuit.copy_empty_like()
    for inst in circuit.data[4:]:
        body.append(inst)
    theirs = Statevector(initial).evolve(bind(body, gammas, betas))
    assert abs(np.vdot(kernel.state(gammas, betas), np.asarray(theirs))) == pytest.approx(1.0, abs=1e-9)


def test_cvar_at_alpha_one_is_the_mean():
    instance = small_instance()
    Q, constant = instance.qubo()
    kernel = QaoaKernel.from_qubo(Q, constant)
    p = kernel.probabilities(np.array([0.5]), np.array([0.3]))
    assert kernel.cvar(p, 1.0) == pytest.approx(kernel.expectation(p))
    assert kernel.cvar(p, 0.1) < kernel.expectation(p)


def test_resources_show_routing_overhead():
    instance = small_instance(n=6, K=3)
    Q, constant = instance.qubo()
    h, J, _ = ising(Q, constant)
    resources = circuit_resources(qaoa_circuit(h, J, 1))
    assert resources["logical_two_qubit"] == 15
    assert resources["heavy_hex"]["two_qubit_gates"] >= resources["all_to_all"]["two_qubit_gates"]
    assert gate_list(qaoa_circuit(h, J, 1))["qubits"] == 6


def _distribution(n=3, seed=1):
    rng = np.random.default_rng(seed)
    probabilities = rng.dirichlet(np.ones(2**n) * 3)
    return LossDistribution(np.linspace(-0.03, 0.04, 2**n), probabilities, n)


def test_a_operator_amplitude_equals_expected_payoff():
    dist = _distribution()
    payoff = np.linspace(0, 1, len(dist.grid))
    assert amplitude(a_operator(dist.probabilities, payoff)) == pytest.approx(dist.probabilities @ payoff, abs=1e-9)


@pytest.mark.parametrize("k", [0, 1, 2, 3])
def test_grover_powers_follow_the_analytic_formula(k):
    """Justifies the exact oracle: P(1) from the real circuit equals sin^2((2k + 1) theta)."""
    dist = _distribution()
    indicator = (np.arange(len(dist.grid)) <= 3).astype(float)
    a = a_operator(dist.probabilities, indicator)
    theta = np.arcsin(np.sqrt(amplitude(a)))
    q = q_operator(a)
    circuit = a.copy()
    for _ in range(k):
        circuit = circuit.compose(q)
    measured = Statevector(circuit).probabilities([a.num_qubits - 1])[1]
    assert measured == pytest.approx(np.sin((2 * k + 1) * theta) ** 2, abs=1e-8)


def test_aer_oracle_agrees_with_exact_oracle():
    dist = _distribution()
    indicator = (np.arange(len(dist.grid)) <= 4).astype(float)
    a = a_operator(dist.probabilities, indicator)
    aer = AerOracle(a)
    exact = ExactOracle(amplitude(a))
    rng = np.random.default_rng(0)
    for k in (0, 1, 2):
        assert aer.ones(k, 8000, rng) / 8000 == pytest.approx(exact.ones(k, 200_000, rng) / 200_000, abs=0.03)


@pytest.mark.parametrize("target", [0.05, 0.3, 0.5, 0.85, 0.97])
def test_iterative_qae_covers_the_truth(target):
    runs = [iterative_qae(ExactOracle(target), epsilon=0.001, shots=100, seed=seed) for seed in range(200)]
    coverage = np.mean([run["ci"][0] <= target <= run["ci"][1] for run in runs])
    assert coverage >= 0.95  # the nominal confidence level
    assert np.median([abs(run["estimate"] - target) for run in runs]) < 0.001


def test_qae_var_cvar_match_the_discrete_truth():
    losses = simulate_losses(np.array([0.5, 0.5]), np.array([0.1, 0.15]), np.array([[0.04, 0.01], [0.01, 0.09]]))
    dist = discretise(losses, 5)
    exact = dist.exact(0.95)
    quantum = qae_risk(dist, 0.95, epsilon=0.001)
    assert abs(quantum["var_index"] - exact["var_index"]) <= 1
    assert quantum["cvar"] == pytest.approx(exact["cvar"], abs=0.01)
    assert monte_carlo_risk(dist, 0.95, 500_000)["var_index"] == pytest.approx(exact["var_index"], abs=1)


def test_measured_scaling_matches_theory():
    """Slope near -1 for QAE and near -1/2 for Monte Carlo, measured and not assumed."""
    losses = simulate_losses(np.array([1.0]), np.array([0.1]), np.array([[0.04]]))
    study = error_scaling_study(discretise(losses, 4), 0.9, repeats=40)
    assert study["qae_slope"] < study["mc_slope"]
    assert -0.65 < study["mc_slope"] < -0.35
