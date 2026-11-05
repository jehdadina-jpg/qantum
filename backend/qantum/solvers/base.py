"""The common solver interface that keeps the quantum and classical paths interchangeable."""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np


@dataclass
class Budget:
    """Matched computational budget. For QAOA, energy_evals = iterations x shots."""

    energy_evals: int = 100_000
    time_limit: float = 60.0


@dataclass
class SolverResult:
    solver: str
    x: np.ndarray
    objective: float
    feasible: bool
    runtime: float
    evaluations: int = 0
    certified: bool = False
    weights: np.ndarray | None = None
    extras: dict = field(default_factory=dict)
