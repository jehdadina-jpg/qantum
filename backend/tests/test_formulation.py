"""O3: QUBO and Ising energies unit-tested against brute force."""

from itertools import product

import numpy as np
import pytest

from qantum.formulation import (
    PortfolioInstance,
    all_energies,
    calibrate_penalty,
    int_to_bits,
    ising,
    popcounts,
    repair,
    sufficient_penalty,
    weight_encoding_qubo,
)


def random_instance(n=8, K=4, seed=0, **kwargs):
    rng = np.random.default_rng(seed)
    A = rng.normal(size=(n, n + 4))
    return PortfolioInstance(
        [f"A{i}" for i in range(n)], rng.normal(0.15, 0.1, n), A @ A.T / (n + 4) * 0.1, K=K, **kwargs
    )


def test_qubo_matches_objective_plus_penalty():
    instance = random_instance(penalty=1.3, tc=0.002)
    instance.holdings = np.array([1, 0, 1, 0, 0, 1, 0, 0])
    Q, constant = instance.qubo()
    for bits in product([0, 1], repeat=instance.n):
        x = np.array(bits, dtype=float)
        direct = instance.objective(x) + instance.penalty * (x.sum() - instance.K) ** 2
        assert x @ Q @ x + constant == pytest.approx(direct)


def test_all_energies_uses_qiskit_bit_order():
    instance = random_instance(n=6, K=3, penalty=0.7)
    Q, constant = instance.qubo()
    energies = all_energies(Q, constant)
    for index in range(2**6):
        x = int_to_bits(index, 6).astype(float)
        assert energies[index] == pytest.approx(x @ Q @ x + constant)


def test_ising_reproduces_qubo():
    instance = random_instance(n=7, K=3, penalty=0.9)
    Q, constant = instance.qubo()
    h, J, offset = ising(Q, constant)
    for index in range(2**7):
        x = int_to_bits(index, 7).astype(float)
        z = 1 - 2 * x
        assert h @ z + z @ J @ z + offset == pytest.approx(x @ Q @ x + constant)


def test_sufficient_penalty_makes_ground_state_feasible():
    instance = random_instance(n=8, K=3)
    instance.penalty = sufficient_penalty(instance)
    Q, constant = instance.qubo()
    energies = all_energies(Q, constant)
    assert popcounts(8)[int(np.argmin(energies))] == 3


def test_calibration_returns_feasible_ground_state_and_no_larger_than_bound():
    instance = random_instance(n=8, K=4)
    calibration = calibrate_penalty(instance)
    assert calibration["penalty"] <= calibration["sufficient_bound"]
    instance.penalty = calibration["penalty"]
    Q, constant = instance.qubo()
    assert popcounts(8)[int(np.argmin(all_energies(Q, constant)))] == 4


def test_repair_reaches_cardinality_from_both_sides():
    instance = random_instance(n=8, K=3)
    assert repair(instance, np.ones(8, dtype=int)).sum() == 3
    assert repair(instance, np.zeros(8, dtype=int)).sum() == 3


def test_weight_encoding_matches_direct_expansion():
    rng = np.random.default_rng(1)
    N, bits, budget = 3, 2, 3
    A = rng.normal(size=(N, N + 2))
    mu, sigma = rng.normal(0.1, 0.05, N), A @ A.T * 0.05
    encoding = weight_encoding_qubo(mu, sigma, bits, budget, q=2.0, penalty=0.8)
    assert encoding.Q.shape == (N * bits, N * bits)
    for index in range(2 ** (N * bits)):
        x = int_to_bits(index, N * bits).astype(float)
        w = encoding.decode(x)
        units = (w * budget).sum()
        direct = 2.0 * w @ sigma @ w - mu @ w + 0.8 * (units - budget) ** 2
        assert x @ encoding.Q @ x + encoding.constant == pytest.approx(direct)
