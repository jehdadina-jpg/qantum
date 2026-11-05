export const NA = "n/a";

export const pct = (value: number | null | undefined, digits = 1) =>
  value === null || value === undefined ? NA : `${(value * 100).toFixed(digits)}%`;

export const signedPct = (value: number | null | undefined, digits = 2) =>
  value === null || value === undefined ? NA : `${value >= 0 ? "+" : ""}${(value * 100).toFixed(digits)}%`;

export const num = (value: number | null | undefined, digits = 2) =>
  value === null || value === undefined ? NA : value.toFixed(digits);

export const int = (value: number | null | undefined) =>
  value === null || value === undefined ? NA : Math.round(value).toLocaleString("en-US");

/** Percentage that does not round a tiny probability down to a misleading 0.0%. */
export const fidelity = (value: number | null | undefined) =>
  value !== null && value !== undefined && value < 0.001 ? "below 0.1%" : pct(value, 1);

export const compact = (value: number | null | undefined) =>
  value === null || value === undefined
    ? NA
    : new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(value);

export function seconds(value: number | null | undefined) {
  if (value === null || value === undefined) return NA;
  if (value < 0.001) return `${(value * 1e6).toFixed(0)} us`;
  if (value < 1) return `${(value * 1000).toFixed(0)} ms`;
  return `${value.toFixed(value < 10 ? 2 : 1)} s`;
}

export function bytes(value: number) {
  const units = ["B", "KiB", "MiB", "GiB", "TiB", "PiB"];
  let index = 0;
  let current = value;
  while (current >= 1024 && index < units.length - 1) {
    current /= 1024;
    index += 1;
  }
  return `${current.toFixed(current < 10 ? 1 : 0)} ${units[index]}`;
}

export const exp10 = (value: number | null | undefined, digits = 1) =>
  value === null || value === undefined ? NA : value.toExponential(digits).replace("e-", "e-").replace("e+", "e");

export function dateTime(value: string | null | undefined) {
  if (!value) return NA;
  return new Date(value).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function date(value: string | null | undefined) {
  if (!value) return NA;
  return new Date(value).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

export const shortHash = (hash: string | null | undefined) => (hash ? hash.slice(0, 10) : NA);
