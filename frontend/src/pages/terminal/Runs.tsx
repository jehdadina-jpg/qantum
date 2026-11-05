import { DownloadSimple, Trash } from "@phosphor-icons/react";
import { useCallback, useEffect, useState } from "react";
import { Empty, ErrorNote, PageHead, Panel, Segmented, Skeleton, Td, Th } from "../../components/ui";
import { api, type Run, type RunHeader } from "../../lib/api";
import { dateTime, shortHash } from "../../lib/format";
import { sameRuns } from "../../lib/hooks";

const KINDS = ["all", "optimise", "risk", "simulate", "benchmark", "backtest", "refresh"];

const STATUS_TONE: Record<string, string> = {
  finished: "text-em",
  failed: "text-loss",
  running: "text-gold",
  queued: "text-dim",
  interrupted: "text-loss",
};

export default function Runs() {
  const [kind, setKind] = useState("all");
  const [runs, setRuns] = useState<RunHeader[] | null>(null);
  const [selected, setSelected] = useState<RunHeader | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await api<{ runs: RunHeader[] }>(`/runs?limit=200${kind === "all" ? "" : `&kind=${kind}`}`);
      setRuns((previous) => (previous && sameRuns(previous, data.runs) ? previous : data.runs));
      setError(null);
    } catch (reason) {
      setError((reason as Error).message);
    }
  }, [kind]);

  useEffect(() => {
    void load();
    const timer = setInterval(() => {
      if (!document.hidden) void load();
    }, 6000);
    return () => clearInterval(timer);
  }, [load]);

  const remove = async (id: string) => {
    try {
      await api(`/runs/${id}`, { method: "DELETE" });
      setSelected(null);
      setConfirming(false);
      void load();
    } catch (reason) {
      setError((reason as Error).message);
    }
  };

  const download = async (id: string) => {
    try {
      const run = await api<Run>(`/runs/${id}`);
      const url = URL.createObjectURL(new Blob([JSON.stringify(run, null, 1)], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `qantum-${run.kind}-${run.id.slice(0, 8)}.json`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (reason) {
      setError((reason as Error).message);
    }
  };

  return (
    <div>
      <PageHead title="Runs">
        <Segmented value={kind} onChange={setKind} options={KINDS.map((k) => ({ value: k, label: k }))} />
      </PageHead>
      {error && (
        <div className="mb-3">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}
      <div className="grid gap-2 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Panel title="Experiment records" aside={runs ? `${runs.length} shown` : undefined}>
          {!runs && <Skeleton className="m-3 h-72" />}
          {runs?.length === 0 && <Empty title="No records here yet">Every experiment you run is stored with its inputs, seed and library versions.</Empty>}
          {runs && runs.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr>
                    <Th align="left">Status</Th>
                    <Th align="left">Kind</Th>
                    <Th align="left">Title</Th>
                    <Th align="left">Created</Th>
                    <Th align="left">Data</Th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((run) => (
                    <tr
                      key={run.id}
                      tabIndex={0}
                      onClick={() => {
                        setSelected(run);
                        setConfirming(false);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") setSelected(run);
                      }}
                      className={`cursor-pointer border-t border-line transition-colors hover:bg-white/[0.04] ${selected?.id === run.id ? "bg-white/[0.06]" : ""}`}
                    >
                      <Td align="left" className={`mono-tight text-[11.5px] ${STATUS_TONE[run.status]}`}>
                        {run.status}
                        {run.progress !== undefined && ` ${Math.round(run.progress * 100)}%`}
                      </Td>
                      <Td align="left" className="text-dim">{run.kind}</Td>
                      <Td align="left" className="max-w-[420px] truncate">{run.title}</Td>
                      <Td align="left" className="mono-tight text-dim tnum">{dateTime(run.created_at)}</Td>
                      <Td align="left" className="mono-tight text-dim">{shortHash(run.data_hash)}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <Panel title="Record" aside={selected ? selected.id.slice(0, 8) : undefined} className="self-start xl:sticky xl:top-[60px]">
          {selected ? (
            <div className="p-3">
              <p className="text-[13px] font-medium">{selected.title}</p>
              <dl className="mt-3 grid gap-1.5 mono-tight text-[11px] tnum">
                <div className="flex justify-between gap-4"><dt className="text-dim">created</dt><dd>{dateTime(selected.created_at)}</dd></div>
                <div className="flex justify-between gap-4"><dt className="text-dim">finished</dt><dd>{dateTime(selected.finished_at)}</dd></div>
                <div className="flex justify-between gap-4"><dt className="text-dim">data hash</dt><dd className="truncate">{shortHash(selected.data_hash)}</dd></div>
                {Object.entries(selected.versions ?? {}).map(([name, version]) => (
                  <div key={name} className="flex justify-between gap-4"><dt className="text-dim">{name}</dt><dd>{version}</dd></div>
                ))}
              </dl>
              {selected.error && (
                <div className="mt-3">
                  <ErrorNote>{selected.error.split("\n")[0]}</ErrorNote>
                </div>
              )}
              <div className="label mt-4 mb-1.5">Specification</div>
              <pre className="max-h-64 overflow-auto bg-white/[0.04] p-2 mono-tight text-[11px] leading-relaxed text-dim">{JSON.stringify(selected.spec, null, 1)}</pre>
              {selected.summary && (
                <>
                  <div className="label mt-4 mb-1.5">Summary</div>
                  <pre className="max-h-48 overflow-auto bg-white/[0.04] p-2 mono-tight text-[11px] leading-relaxed text-dim">{JSON.stringify(selected.summary, null, 1)}</pre>
                </>
              )}
              <div className="mt-4 flex gap-2">
                <button onClick={() => download(selected.id)} className="flex h-8 flex-1 items-center justify-center gap-1.5 bg-white/[0.055] shadow-[inset_0_0_0_1px_rgb(255_255_255/0.09)] text-[12px] transition-colors hover:bg-white/[0.04]">
                  <DownloadSimple size={14} /> Export JSON
                </button>
                {confirming ? (
                  <button onClick={() => remove(selected.id)} className="flex h-8 flex-1 items-center justify-center gap-1.5 bg-loss text-[12px] font-semibold text-ink">
                    Confirm delete
                  </button>
                ) : (
                  <button onClick={() => setConfirming(true)} disabled={selected.status === "running" || selected.status === "queued"} className="flex h-8 flex-1 items-center justify-center gap-1.5 bg-white/[0.055] shadow-[inset_0_0_0_1px_rgb(255_255_255/0.09)] text-[12px] text-dim transition-colors hover:text-loss disabled:opacity-50">
                    <Trash size={14} /> Delete
                  </button>
                )}
              </div>
            </div>
          ) : (
            <Empty title="Select a record">Its full specification, inputs hash and library versions appear here, so any result can be reproduced.</Empty>
          )}
        </Panel>
      </div>
    </div>
  );
}
