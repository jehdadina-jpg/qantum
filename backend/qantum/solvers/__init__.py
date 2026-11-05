"""Module 2 solvers behind one interface: solve(instance, budget) -> SolverResult."""

from .base import Budget, SolverResult
from .brute import solve_brute_force
from .miqp import solve_miqp
from .mvo import efficient_frontier, max_sharpe, solve_mvo
from .qaoa import QaoaConfig, solve_qaoa
from .sa import solve_simulated_annealing

__all__ = [
    "Budget",
    "QaoaConfig",
    "SolverResult",
    "efficient_frontier",
    "max_sharpe",
    "solve_brute_force",
    "solve_miqp",
    "solve_mvo",
    "solve_qaoa",
    "solve_simulated_annealing",
]
