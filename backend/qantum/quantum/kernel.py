"""Exact QAOA statevector kernel.

The cost layer is diagonal and the X mixer is a tensor product, so a full evaluation needs
no gate-by-gate simulation. tests/test_quantum.py checks this kernel amplitude by amplitude
against qiskit.quantum_info.Statevector run on the circuit from circuits.py.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
from scipy.stats import qmc

from ..formulation import all_energies, ising, popcounts


def interpolate_angles(values: np.ndarray) -> np.ndarray:
    """Layer-wise warm start: map optimal angles at depth p - 1 onto depth p."""
    p = len(values)
    extended = np.concatenate([[0.0], values, [0.0]])
    return np.array([(i / (p + 1)) * extended[i] + (1 - i / (p + 1)) * extended[i + 1] for i in range(p + 1)])


@dataclass
class QaoaKernel:
    n: int
    energies: np.ndarray
    offset: float
    scale: float
    mixer: str = "x"
    K: int | None = None
    _phases: np.ndarray = field(init=False, repr=False)
    _pairs: list = field(init=False, repr=False, default_factory=list)
    _order: np.ndarray | None = field(init=False, repr=False, default=None)

    def __post_init__(self) -> None:
        self._phases = (self.energies - self.offset) / self.scale
        if self.mixer == "xy":
            if self.K is None:
                raise ValueError("The XY mixer needs the cardinality K for its Dicke start state")
            self._pairs = self._ring_pairs()

    @classmethod
    def from_qubo(cls, Q: np.ndarray, constant: float = 0.0, mixer: str = "x", K: int | None = None) -> "QaoaKernel":
        h, J, offset = ising(Q, constant)
        return cls(
            n=len(Q),
            energies=all_energies(Q, constant),
            offset=offset,
            scale=ising_scale(h, J),
            mixer=mixer,
            K=K,
        )

    def _ring_pairs(self) -> list[tuple[np.ndarray, np.ndarray]]:
        n = self.n
        indices = np.arange(2**n)
        edges = [(i, (i + 1) % n) for i in range(0, n, 2)] + [(i, (i + 1) % n) for i in range(1, n, 2)]
        pairs = []
        for i, j in edges:
            if i == j:
                continue
            bit_i, bit_j = (indices >> i) & 1, (indices >> j) & 1
            low = indices[(bit_i == 0) & (bit_j == 1)]
            pairs.append((low, low ^ ((1 << i) | (1 << j))))
        return pairs

    def initial_state(self) -> np.ndarray:
        if self.mixer == "xy":
            mask = popcounts(self.n) == self.K
            state = np.zeros(2**self.n, dtype=complex)
            state[mask] = 1 / np.sqrt(mask.sum())
            return state
        return np.full(2**self.n, 2 ** (-self.n / 2), dtype=complex)

    def _apply_x_mixer(self, state: np.ndarray, beta: float) -> None:
        c, s = np.cos(beta), -1j * np.sin(beta)
        for qubit in range(self.n):
            view = state.reshape(-1, 2, 1 << qubit)
            low = view[:, 0, :].copy()
            high = view[:, 1, :].copy()
            view[:, 0, :] = c * low + s * high
            view[:, 1, :] = s * low + c * high

    def _apply_xy_mixer(self, state: np.ndarray, beta: float) -> None:
        c, s = np.cos(beta), -1j * np.sin(beta)
        for low, high in self._pairs:
            a, b = state[low].copy(), state[high].copy()
            state[low] = c * a + s * b
            state[high] = s * a + c * b

    def state(self, gammas: np.ndarray, betas: np.ndarray) -> np.ndarray:
        """Equation (10). Cost unitaries use the Hamiltonian normalised by `scale`."""
        state = self.initial_state()
        for gamma, beta in zip(gammas, betas):
            state *= np.exp(-1j * gamma * self._phases)
            if self.mixer == "xy":
                self._apply_xy_mixer(state, beta)
            else:
                self._apply_x_mixer(state, beta)
        return state

    def probabilities(self, gammas: np.ndarray, betas: np.ndarray) -> np.ndarray:
        return np.abs(self.state(gammas, betas)) ** 2

    def expectation(self, probabilities: np.ndarray) -> float:
        return float(probabilities @ self.energies)

    def cvar(self, probabilities: np.ndarray, alpha: float) -> float:
        """Mean energy of the best alpha fraction of the distribution."""
        if self._order is None:
            self._order = np.argsort(self.energies)
        ordered = probabilities[self._order]
        cumulative = np.cumsum(ordered)
        cut = int(np.searchsorted(cumulative, alpha))
        weights = ordered[: cut + 1].copy()
        weights[-1] -= max(cumulative[cut] - alpha, 0.0)
        return float(weights @ self.energies[self._order][: cut + 1] / max(weights.sum(), 1e-15))


def ising_scale(h: np.ndarray, J: np.ndarray) -> float:
    """Standard deviation of H_C under the uniform superposition, used to normalise angles."""
    return float(np.sqrt((h**2).sum() + (J**2).sum())) or 1.0


def sobol_box(points: int, gamma_max: float, seed: int = 0) -> np.ndarray:
    """Quasi-random (gamma, beta) starting points covering the p = 1 parameter box."""
    unit = qmc.Sobol(2, seed=seed).random_base2(int(np.ceil(np.log2(max(points, 2)))))
    return unit * np.array([gamma_max, np.pi / 2])


def distinct_seeds(scored: list[tuple[float, float, float]], gamma_max: float, separation: float = 0.1) -> list[tuple[float, float, float]]:
    """Best first, keeping only starts that sit in different parts of the box, for multi-start."""
    chosen: list[tuple[float, float, float]] = []
    for gamma, beta, value in sorted(scored, key=lambda s: s[2]):
        close = any(
            np.hypot((gamma - g) / gamma_max, (beta - b) / (np.pi / 2)) < separation for g, b, _ in chosen
        )
        if not close:
            chosen.append((gamma, beta, value))
    return chosen


def seed_search(
    kernel: "QaoaKernel", objective, gamma_max: float, points: int = 256, seed: int = 0
) -> list[tuple[float, float, float]]:
    """Evaluate the p = 1 objective over the box and return distinct (gamma, beta, value) seeds."""
    scored = []
    for gamma, beta in sobol_box(points, gamma_max, seed):
        probabilities = kernel.probabilities(np.array([gamma]), np.array([beta]))
        scored.append((float(gamma), float(beta), float(objective(probabilities))))
    return distinct_seeds(scored, gamma_max)
