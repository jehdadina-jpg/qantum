// Exact QAOA in the browser. Same maths as backend/qantum/quantum/kernel.py, on a real instance
// exported from the price snapshot by `python -m qantum.export_hero`.

import hero from "../data/hero-instance.json";

export const instance = hero;
export const N = hero.tickers.length;
export const SIZE = 1 << N;

function allEnergies(Q: number[][], constant: number): Float64Array {
  const energies = new Float64Array(SIZE);
  for (let index = 1; index < SIZE; index += 1) {
    const top = 31 - Math.clz32(index);
    const rest = index ^ (1 << top);
    let value = energies[rest] + Q[top][top];
    for (let j = 0; j < top; j += 1) {
      if ((rest >> j) & 1) value += 2 * Q[top][j];
    }
    energies[index] = value;
  }
  for (let index = 0; index < SIZE; index += 1) energies[index] += constant;
  return energies;
}

export const energies = allEnergies(hero.Q, hero.constant);
const phases = energies.map((energy) => (energy - hero.offset) / hero.scale);

export const popcount = (value: number) => {
  let count = 0;
  for (let v = value; v; v &= v - 1) count += 1;
  return count;
};

export const feasible = Array.from({ length: SIZE }, (_, index) => popcount(index) === hero.K);
export const optimumIndex = hero.optimum.reduce((acc, bit, i) => acc + (bit << i), 0);

const feasibleEnergies = energies.filter((_, index) => feasible[index]);
export const feasibleMin = Math.min(...feasibleEnergies);
export const feasibleMax = Math.max(...feasibleEnergies);

/** Equation (10): cost phases, then an RX(2 beta) on every qubit, for each layer. Returns probabilities. */
export function qaoaProbabilities(gammas: number[], betas: number[]): Float64Array {
  const re = new Float64Array(SIZE).fill(Math.pow(2, -N / 2));
  const im = new Float64Array(SIZE);
  for (let layer = 0; layer < gammas.length; layer += 1) {
    const gamma = gammas[layer];
    for (let index = 0; index < SIZE; index += 1) {
      const angle = -gamma * phases[index];
      const c = Math.cos(angle);
      const s = Math.sin(angle);
      const a = re[index];
      const b = im[index];
      re[index] = a * c - b * s;
      im[index] = a * s + b * c;
    }
    const c = Math.cos(betas[layer]);
    const s = Math.sin(betas[layer]);
    for (let qubit = 0; qubit < N; qubit += 1) {
      const bit = 1 << qubit;
      for (let low = 0; low < SIZE; low += 1) {
        if (low & bit) continue;
        const high = low | bit;
        const lowRe = re[low];
        const lowIm = im[low];
        const highRe = re[high];
        const highIm = im[high];
        // (c, -i s; -i s, c) acting on the (low, high) amplitude pair
        re[low] = c * lowRe + s * highIm;
        im[low] = c * lowIm - s * highRe;
        re[high] = c * highRe + s * lowIm;
        im[high] = c * highIm - s * lowRe;
      }
    }
  }
  const probabilities = new Float64Array(SIZE);
  for (let index = 0; index < SIZE; index += 1) probabilities[index] = re[index] * re[index] + im[index] * im[index];
  return probabilities;
}

export function describe(probabilities: Float64Array) {
  let feasibility = 0;
  let conditional = 0;
  for (let index = 0; index < SIZE; index += 1) {
    if (feasible[index]) {
      feasibility += probabilities[index];
      conditional += probabilities[index] * energies[index];
    }
  }
  conditional /= Math.max(feasibility, 1e-15);
  return {
    success: probabilities[optimumIndex],
    feasibility,
    quality: (feasibleMax - conditional) / (feasibleMax - feasibleMin),
  };
}

export function topStrings(probabilities: Float64Array, count: number) {
  return Array.from(probabilities, (probability, index) => ({ index, probability }))
    .sort((a, b) => b.probability - a.probability)
    .slice(0, count)
    .map(({ index, probability }) => ({
      index,
      probability,
      energy: energies[index],
      feasible: feasible[index],
      optimum: index === optimumIndex,
      bits: Array.from({ length: N }, (_, i) => (index >> i) & 1).join(""),
    }));
}

export const uniform = new Float64Array(SIZE).fill(1 / SIZE);
