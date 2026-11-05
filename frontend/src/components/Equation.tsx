import equations from "../data/equations.json";

export type EquationName = keyof typeof equations;

/** Static HTML from scripts/render-equations.mjs. Only KaTeX's stylesheet ships to the browser. */
export function Equation({ name, className = "" }: { name: EquationName; className?: string }) {
  return <div className={`eq-left overflow-x-auto overflow-y-hidden ${className}`} dangerouslySetInnerHTML={{ __html: equations[name] }} />;
}
