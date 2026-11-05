"""Qiskit circuits for QAOA, transpilation and hardware resource accounting."""

from __future__ import annotations

from functools import lru_cache

import numpy as np
from qiskit import QuantumCircuit, transpile
from qiskit.circuit import ParameterVector
from qiskit.circuit.library import XXPlusYYGate
from qiskit.transpiler import CouplingMap

from .kernel import ising_scale
from .noise import DEFAULT_NOISE, NoiseParameters

BASIS_GATES = ["rz", "sx", "x", "cz"]


def qaoa_circuit(h: np.ndarray, J: np.ndarray, p: int, mixer: str = "x", measure: bool = True) -> QuantumCircuit:
    """Figure 7.1: Hadamards, then p layers of RZ and RZZ cost rotations and an RX mixer."""
    n = len(h)
    scale = ising_scale(h, J)
    gammas = ParameterVector("gamma", p)
    betas = ParameterVector("beta", p)
    circuit = QuantumCircuit(n, name=f"qaoa_p{p}")
    circuit.h(range(n))
    for layer in range(p):
        for i in range(n):
            if h[i]:
                circuit.rz(2 * gammas[layer] * float(h[i] / scale), i)
        for i in range(n):
            for j in range(i + 1, n):
                if J[i, j]:
                    circuit.rzz(2 * gammas[layer] * float(J[i, j] / scale), i, j)
        if mixer == "xy":
            for i in list(range(0, n, 2)) + list(range(1, n, 2)):
                j = (i + 1) % n
                if i != j:
                    circuit.append(XXPlusYYGate(2 * betas[layer]), [i, j])
        else:
            for i in range(n):
                circuit.rx(2 * betas[layer], i)
    if measure:
        circuit.measure_all()
    return circuit


def bind(circuit: QuantumCircuit, gammas: np.ndarray, betas: np.ndarray) -> QuantumCircuit:
    params = {p.name: p for p in circuit.parameters}
    values = {}
    for i, value in enumerate(gammas):
        values[params[f"gamma[{i}]"]] = float(value)
    for i, value in enumerate(betas):
        values[params[f"beta[{i}]"]] = float(value)
    return circuit.assign_parameters(values)


@lru_cache(maxsize=8)
def heavy_hex(qubits_needed: int) -> CouplingMap:
    distance = 3
    while True:
        coupling = CouplingMap.from_heavy_hex(distance)
        if coupling.size() >= qubits_needed:
            return coupling
        distance += 2


def _counts(circuit: QuantumCircuit) -> dict:
    ops = circuit.count_ops()
    two_qubit = sum(1 for inst in circuit.data if inst.operation.num_qubits == 2)
    one_qubit = sum(1 for inst in circuit.data if inst.operation.num_qubits == 1 and inst.operation.name not in ("measure", "barrier"))
    depth = circuit.depth(lambda inst: inst.operation.name not in ("measure", "barrier"))
    two_qubit_depth = circuit.depth(lambda inst: inst.operation.num_qubits == 2)
    return {
        "depth": depth,
        "two_qubit_depth": two_qubit_depth,
        "two_qubit_gates": two_qubit,
        "one_qubit_gates": one_qubit,
        "ops": {str(k): int(v) for k, v in ops.items()},
    }


def estimated_success_probability(counts: dict, noise: NoiseParameters, measured_qubits: int) -> float:
    """Product of gate and readout fidelities: a first-order estimate, ignoring idle errors."""
    return float(
        (1 - noise.p1) ** counts["one_qubit_gates"]
        * (1 - noise.p2) ** counts["two_qubit_gates"]
        * (1 - noise.readout) ** measured_qubits
    )


def circuit_resources(circuit: QuantumCircuit, noise: NoiseParameters = DEFAULT_NOISE, seed: int = 11) -> dict:
    """Transpiled cost on all-to-all connectivity and on a heavy-hex lattice with SWAP routing."""
    ideal = transpile(circuit, basis_gates=BASIS_GATES, optimization_level=1, seed_transpiler=seed)
    routed = transpile(
        circuit,
        basis_gates=BASIS_GATES,
        coupling_map=heavy_hex(circuit.num_qubits),
        optimization_level=1,
        seed_transpiler=seed,
    )
    all_to_all, heavy = _counts(ideal), _counts(routed)
    all_to_all["esp"] = estimated_success_probability(all_to_all, noise, circuit.num_qubits)
    heavy["esp"] = estimated_success_probability(heavy, noise, circuit.num_qubits)
    return {
        "qubits": circuit.num_qubits,
        "logical_two_qubit": sum(1 for inst in circuit.data if inst.operation.num_qubits == 2),
        "all_to_all": all_to_all,
        "heavy_hex": heavy,
        "noise_assumed": noise.as_dict(),
    }


def gate_list(circuit: QuantumCircuit) -> dict:
    """ASAP-layered gates for the front-end circuit drawing."""
    n = circuit.num_qubits
    frontier = [0] * n
    gates = []
    positions = {q: i for i, q in enumerate(circuit.qubits)}
    for inst in circuit.data:
        name = inst.operation.name
        if name == "barrier":
            continue
        qubits = [positions[q] for q in inst.qubits]
        span = range(min(qubits), max(qubits) + 1) if len(qubits) > 1 else qubits
        column = max(frontier[q] for q in span)
        for q in span:
            frontier[q] = column + 1
        param = None
        if inst.operation.params:
            param = str(inst.operation.params[0])
        gates.append({"name": name, "qubits": qubits, "column": column, "param": param})
    return {"qubits": n, "columns": max(frontier) if frontier else 0, "gates": gates}
