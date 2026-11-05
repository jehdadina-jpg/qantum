// Renders the landing page's equations to static HTML, so KaTeX's JavaScript never reaches the
// browser. Run after changing an equation: node scripts/render-equations.mjs
import katex from "katex";
import { writeFileSync } from "node:fs";

const equations = {
  count: String.raw`\binom{50}{10}\;=`,
  estimate: String.raw`\hat{\Sigma} = 252\,[(1-\delta)S + \delta F]`,
  encode: String.raw`f(x) = q\,x^\top \Sigma x - \mu^\top x + P\Big(\sum_i x_i - K\Big)^{2}`,
  prepare: String.raw`|\gamma,\beta\rangle = \prod_{\ell=1}^{p} e^{-i\beta_\ell H_M} e^{-i\gamma_\ell H_C} |+\rangle^{\otimes n}`,
  sample: String.raw`F_p = \langle\gamma,\beta|H_C|\gamma,\beta\rangle \approx \tfrac{1}{S}\sum_{s} f(x_s)`,
  decode: String.raw`w = x / K`,
};

const rendered = Object.fromEntries(
  Object.entries(equations).map(([name, tex]) => [name, katex.renderToString(tex, { displayMode: true, throwOnError: true, output: "html" })]),
);
writeFileSync(new URL("../src/data/equations.json", import.meta.url), JSON.stringify(rendered));
console.log(`Rendered ${Object.keys(rendered).length} equations`);
