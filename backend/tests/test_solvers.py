"""M3: every baseline agrees on small instances, and QAOA reproduces the ground truth."""

import numpy as np
import pytest

from qantum.formulation import PortfolioInstance, calibrate_penalty
from qantum.solvers import (
    Budget,
    QaoaConfig,
    efficient_frontier,
    solve_brute_force,
    solve_miqp,
    solve_mvo,
    solve_qaoa,
    solve_simulated_annealing,
)


def instance_for(seed, n=10, K=5, **kwargs):
    rng = np.random.default_rng(seed)
    A = rng.normal(size=(n, n + 6))
    return PortfolioInstance(
        [f"A{i}" for i in range(n)], rng.normal(0.15, 0.12, n), A @ A.T / (n + 6) * 0.1, K=K, **kwargs
    )


@pytest.mark.parametrize("seed", range(12))
def test_miqp_certifies_the_brute_force_optimum(seed):
    instance = instance_for(seed, n=6 + seed % 7, K=2 + seed % 4, tc=0.001 * (seed % 3))
    exact = solve_miqp(instance)
    brute = solve_brute_force(instance)
    assert exact.certified
    assert exact.objective == pytest.approx(brute.objective, abs=1e-9)
    assert exact.x.sum() == instance.K


@pytest.mark.parametrize("seed", range(5))
def test_annealing_finds_the_optimum_on_small_instances(seed):
    instance = instance_for(seed + 20, n=8, K=4)
    instance.penalty = calibrate_penalty(instance)["sufficient_bound"]
    annealed = solve_simulated_annealing(instance, Budget(energy_evals=30_000), seed=seed)
    assert annealed.objective == pytest.approx(solve_brute_force(instance).objective, abs=1e-9)


@pytest.mark.parametrize("seed", range(4))
def test_qaoa_reproduces_the_optimum_at_small_n(seed):
    instance = instance_for(seed + 40, n=6, K=3)
    instance.penalty = calibrate_penalty(instance)["penalty"]
    result = solve_qaoa(instance, config=QaoaConfig(p=3, maxiter=150, restarts=3, seed=seed, resources=False))
    optimum = solve_brute_force(instance).objective
    assert result.x.sum() == instance.K
    assert result.objective == pytest.approx(optimum, abs=1e-9)
    assert result.extras["success_probability"] > 1 / 20  # better than uniform over 20 feasible strings


def test_deeper_qaoa_improves_expected_energy_on_average():
    gains = []
    for seed in range(5):
        instance = instance_for(seed + 60, n=8, K=4)
        instance.penalty = calibrate_penalty(instance)["penalty"]
        common = dict(objective="mean", maxiter=200, restarts=2, seed=seed, resources=False)
        shallow = solve_qaoa(instance, config=QaoaConfig(p=1, **common)).extras["approximation_ratio"]
        deep = solve_qaoa(instance, config=QaoaConfig(p=3, **common)).extras["approximation_ratio"]
        gains.append(deep - shallow)
    assert np.mean(gains) > 0


def test_xy_mixer_stays_feasible():
    instance = instance_for(70, n=6, K=3)
    instance.penalty = calibrate_penalty(instance)["penalty"]
    result = solve_qaoa(instance, config=QaoaConfig(p=2, mixer="xy", maxiter=60, restarts=1, resources=False))
    assert result.extras["feasibility_rate"] == pytest.approx(1.0)


def test_aer_shot_mode_runs_and_decodes_feasibly():
    instance = instance_for(80, n=5, K=2)
    instance.penalty = calibrate_penalty(instance)["penalty"]
    result = solve_qaoa(instance, config=QaoaConfig(p=1, mode="shots", maxiter=30, restarts=1, shots=256, resources=False))
    assert result.x.sum() == 2
    assert 0 <= result.extras["feasibility_rate"] <= 1


def test_mps_mode_runs_past_the_exact_limit():
    """N = 26 has no exact kernel here, so this exercises the sampled-energy path end to end."""
    instance = instance_for(85, n=26, K=4, penalty=1.0)
    config = QaoaConfig(p=1, mode="mps", maxiter=10, seed_points=8, restarts=1, shots=64, resources=False)
    result = solve_qaoa(instance, config=config)
    assert result.x.sum() == 4
    assert result.extras["success_probability"] is None  # unknowable without enumeration


def test_noise_mode_lowers_success_probability_at_high_noise():
    instance = instance_for(90, n=6, K=3)
    instance.penalty = calibrate_penalty(instance)["penalty"]
    common = dict(p=3, maxiter=120, restarts=2, shots=4096, resources=False, seed=1)
    ideal = solve_qaoa(instance, config=QaoaConfig(**common)).extras["success_probability"]
    noisy = solve_qaoa(instance, config=QaoaConfig(mode="noise", noise_scale=5.0, **common)).extras["success_probability"]
    assert noisy < ideal


def test_frontier_dominates_binary_portfolios():
    instance = instance_for(100, n=8, K=4)
    frontier = efficient_frontier(instance.mu, instance.sigma, points=25)
    vols = np.array([f["vol"] for f in frontier])
    rets = np.array([f["ret"] for f in frontier])
    assert np.all(np.diff(rets) >= -1e-6)
    x = np.zeros(8)
    x[:4] = 0.25
    vol, ret = float(np.sqrt(x @ instance.sigma @ x)), float(instance.mu @ x)
    if ret >= rets[0]:
        assert vol >= np.interp(ret, rets, vols) - 1e-4


def test_mvo_reference_is_a_valid_allocation():
    weights = solve_mvo(instance_for(110)).weights
    assert weights.sum() == pytest.approx(1)
    assert (weights >= 0).all()
