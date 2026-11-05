import { useDeferredValue, useState } from "react";
import { CircuitDiagram, COLORS, Legend, LineChart } from "../../components/charts";
import { Empty, ErrorNote, Field, PageHead, Panel, Select, Skeleton, Slider, Stat, Td, Th } from "../../components/ui";
import type { CircuitPreview, CircuitScaling } from "../../lib/api";
import { useFetch } from "../../lib/hooks";
import { bytes, fidelity, int, num } from "../../lib/format";

export default function Circuits() {
  const [n, setN] = useState(6);
  const [p, setP] = useState(1);
  const [mixer, setMixer] = useState<"x" | "xy">("x");
  const deferredN = useDeferredValue(n);
  const deferredP = useDeferredValue(p);
  const { data: preview, error, loading } = useFetch<CircuitPreview>(`/circuits/preview?n=${deferredN}&p=${deferredP}&mixer=${mixer}`);
  const { data: scaling, error: scalingError } = useFetch<CircuitScaling>(`/circuits/scaling?p=${deferredP}`);

  return (
    <div>
      <PageHead title="Circuits">
        <span className="text-[12px] text-dim">Real Qiskit transpilation of the real instance, on ideal and on sparse connectivity.</span>
      </PageHead>

      <div className="grid gap-2 xl:grid-cols-[264px_minmax(0,1fr)]">
        <aside>
          <Panel title="Circuit" className="xl:sticky xl:top-[60px]" bodyClassName="grid gap-3.5 px-4 pb-4 pt-1">
            <Field label="Assets N, one qubit each" value={n}>
              <Slider value={n} onChange={setN} min={2} max={16} />
            </Field>
            <Field label="Layers p" value={p}>
              <Slider value={p} onChange={setP} min={1} max={5} />
            </Field>
            <Field label="Mixer">
              <Select value={mixer} onChange={setMixer} options={[{ value: "x", label: "Transverse field" }, { value: "xy", label: "XY ring, keeps K fixed" }]} />
            </Field>
            <p className="text-[11px] leading-snug text-faint">Each qubit is one of the {n} largest NIFTY 50 constituents, with K set to half of N. The XY cost excludes preparing its Dicke start state.</p>
          </Panel>
        </aside>

        <div className="grid min-w-0 gap-3">
          {error && <ErrorNote>{error}</ErrorNote>}
          <div className="grid grid-cols-2 gap-x-6 gap-y-5 glass stat-enter px-4 py-4 md:grid-cols-3 xl:grid-cols-6">
            {preview ? (
              <>
                <Stat label="Qubits" value={preview.resources.qubits} />
                <Stat label="Logical 2Q" value={int(preview.resources.logical_two_qubit)} hint="Before transpiling" />
                <Stat label="Depth, all-to-all" value={int(preview.resources.all_to_all.depth)} tone="em" hint={`${int(preview.resources.all_to_all.two_qubit_gates)} CZ gates`} />
                <Stat label="Depth, heavy-hex" value={int(preview.resources.heavy_hex.depth)} tone="gold" hint={`${int(preview.resources.heavy_hex.two_qubit_gates)} CZ gates after routing`} />
                <Stat label="Est. fidelity" value={fidelity(preview.resources.heavy_hex.esp)} tone={preview.resources.heavy_hex.esp < 0.1 ? "loss" : undefined} hint="Gate and readout fidelity product, heavy-hex" />
                <Stat label="Statevector RAM" value={bytes(preview.statevector_memory_bytes)} hint={`2^${n} complex doubles`} />
              </>
            ) : (
              <Skeleton className="col-span-full h-14" />
            )}
          </div>

          <Panel title="Circuit diagram" aside={preview ? `${preview.drawing.gates.length} logical gates${loading ? ", updating" : ""}` : undefined}>
            <div className="p-3">
              {preview ? <CircuitDiagram drawing={preview.drawing} /> : <Skeleton className="h-56" />}
            </div>
            <p className="border-t border-line px-3 py-2 text-[11px] text-dim">
              H prepares the superposition over all portfolios. RZ and the linked RZZ pairs apply the cost, and dense covariance links every pair of qubits. {mixer === "xy" ? "XX+YY pairs are the ring mixer." : "RX is the mixer."} Then every qubit is measured.
            </p>
          </Panel>

          <div className="grid gap-2 xl:grid-cols-2">
            <Panel title="Cost against size" aside={`p = ${deferredP}`}>
              {scalingError && <div className="p-3"><ErrorNote>{scalingError}</ErrorNote></div>}
              {scaling ? (
                <>
                  <LineChart
                    height={280}
                    yLog
                    xLabel="Assets N"
                    yLabel="Transpiled 2Q gates"
                    series={[
                      { label: "Heavy-hex", color: COLORS.gold, points: scaling.rows.map((r) => [r.n, Math.max(r.routed_two_qubit, 1)]), dots: true },
                      { label: "All-to-all", color: COLORS.em, points: scaling.rows.map((r) => [r.n, Math.max(r.two_qubit, 1)]), dots: true },
                    ]}
                  />
                  <div className="px-3 pb-2">
                    <Legend items={[{ label: "All-to-all", color: COLORS.em }, { label: "Heavy-hex, with SWAP routing", color: COLORS.gold }]} />
                  </div>
                </>
              ) : (
                !scalingError && <Skeleton className="m-3 h-64" />
              )}
            </Panel>
            <Panel title="Qubits by encoding" aside="exact simulation limit marked">
              {scaling ? (
                <>
                  <LineChart
                    height={280}
                    xLabel="Assets N"
                    yLabel="Logical qubits"
                    markers={[{ y: scaling.statevector_limit_qubits, label: "about 30 qubits: statevector limit", color: COLORS.gold }]}
                    series={[
                      { label: "1 bit", color: COLORS.em, points: scaling.encoding.map((r) => [r.n_assets, r.b1]), width: 2 },
                      { label: "2 bits", color: COLORS.sky, points: scaling.encoding.map((r) => [r.n_assets, r.b2]) },
                      { label: "3 bits", color: COLORS.dim, points: scaling.encoding.map((r) => [r.n_assets, r.b3]) },
                      { label: "4 bits", color: COLORS.faint, points: scaling.encoding.map((r) => [r.n_assets, r.b4]) },
                    ]}
                  />
                  <div className="px-3 pb-2">
                    <Legend items={[{ label: "Selection, 1 bit per asset", color: COLORS.em }, { label: "2-bit weights", color: COLORS.sky }, { label: "3-bit", color: COLORS.dim }, { label: "4-bit", color: COLORS.faint }]} />
                  </div>
                </>
              ) : (
                <Skeleton className="m-3 h-64" />
              )}
            </Panel>
          </div>

          <Panel title="Transpiled resources" aside={`p = ${deferredP}`}>
            {scaling ? (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr>
                      <Th align="left">N</Th>
                      <Th>Logical 2Q</Th>
                      <Th>Depth</Th>
                      <Th>CZ gates</Th>
                      <Th>Routed depth</Th>
                      <Th>Routed CZ</Th>
                      <Th>Fidelity, all-to-all</Th>
                      <Th>Fidelity, heavy-hex</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {scaling.rows.map((r) => (
                      <tr key={r.n} className="border-t border-line">
                        <Td align="left">{r.n}</Td>
                        <Td>{int(r.logical_two_qubit)}</Td>
                        <Td>{int(r.depth)}</Td>
                        <Td>{int(r.two_qubit)}</Td>
                        <Td>{int(r.routed_depth)}</Td>
                        <Td>{int(r.routed_two_qubit)}</Td>
                        <Td>{fidelity(r.esp_all_to_all)}</Td>
                        <Td className={r.esp_heavy_hex < 0.1 ? "text-loss" : ""}>{fidelity(r.esp_heavy_hex)}</Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty title="Transpiling">Routing the larger circuits takes a few seconds the first time. Results are cached after that.</Empty>
            )}
            {preview && <p className="border-t border-line px-3 py-2 text-[11px] text-dim">Fidelity assumes 2Q error {num(preview.resources.noise_assumed.p2, 4)}, 1Q error {num(preview.resources.noise_assumed.p1, 4)} and readout error {num(preview.resources.noise_assumed.readout, 3)}. These are stated assumptions and describe no specific device.</p>}
          </Panel>
        </div>
      </div>
    </div>
  );
}
