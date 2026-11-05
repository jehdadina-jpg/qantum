"""Parametric noise model for Aer.

The default rates are representative orders of magnitude for superconducting processors.
They are a stated assumption and do not describe any specific device on any specific day.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass

from qiskit_aer.noise import NoiseModel, ReadoutError, depolarizing_error


@dataclass(frozen=True)
class NoiseParameters:
    p1: float = 3e-4
    p2: float = 8e-3
    readout: float = 1.5e-2

    def scaled(self, factor: float) -> "NoiseParameters":
        return NoiseParameters(self.p1 * factor, self.p2 * factor, min(self.readout * factor, 0.5))

    def as_dict(self) -> dict:
        return asdict(self)


DEFAULT_NOISE = NoiseParameters()


def noise_model(parameters: NoiseParameters = DEFAULT_NOISE) -> NoiseModel:
    model = NoiseModel(basis_gates=["rz", "sx", "x", "cz", "id"])
    if parameters.p1 > 0:
        model.add_all_qubit_quantum_error(depolarizing_error(parameters.p1, 1), ["sx", "x"])
    if parameters.p2 > 0:
        model.add_all_qubit_quantum_error(depolarizing_error(parameters.p2, 2), ["cz"])
    if parameters.readout > 0:
        r = parameters.readout
        model.add_all_qubit_readout_error(ReadoutError([[1 - r, r], [r, 1 - r]]))
    return model
