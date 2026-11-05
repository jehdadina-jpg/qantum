import { ArrowsClockwise } from "@phosphor-icons/react";
import { useMemo, useState } from "react";
import { HeatMatrix, LineChart, COLORS, Spark, Treemap } from "../../components/charts";
import { ErrorNote, PageHead, Panel, Segmented, Skeleton, Stat, Td, Th } from "../../components/ui";
import { post, type Overview, type Quality, type RunHeader } from "../../lib/api";
import { useFetch, useReadOnly } from "../../lib/hooks";
import { compact, date, dateTime, int, num, pct, shortHash, signedPct } from "../../lib/format";

const HORIZONS = ["1D", "1W", "1M", "3M", "1Y"];

interface Estimates {
  tickers: string[];
  mu: number[];
  vol: number[];
  corr: number[][];
  meta: { window: number; shrinkage: number | null; start: string; end: string };
}

export default function Markets() {
  const readOnly = useReadOnly();
  const { data: overview, error, loading } = useFetch<Overview>("/market/overview");
  const { data: quality } = useFetch<Quality>("/market/quality");
  const { data: estimates } = useFetch<Estimates>("/market/estimates?n=16");
  const [horizon, setHorizon] = useState("1D");
  const [selected, setSelected] = useState<string | null>(null);
  const [onlyIssues, setOnlyIssues] = useState(true);
  const [refresh, setRefresh] = useState<string | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);

  const tile = overview?.tiles.find((t) => t.symbol === selected) ?? overview?.tiles[0];
  const breadth = useMemo(() => {
    if (!overview) return null;
    const values = overview.tiles.map((t) => t.returns[horizon]).filter((v): v is number => v !== null);
    return { up: values.filter((v) => v > 0).length, down: values.filter((v) => v < 0).length };
  }, [overview, horizon]);
  const qualityRows = (quality?.rows ?? []).filter((r) => !onlyIssues || r.missing || r.stale_runs || r.outliers || r.observations < (quality?.sessions ?? 0));

  const startRefresh = async () => {
    setRefreshError(null);
    try {
      const run = await post<RunHeader>("/market/refresh");
      setRefresh(run.id);
    } catch (reason) {
      setRefreshError((reason as Error).message);
    }
  };

  if (loading) return <Skeleton className="h-[70vh]" />;
  if (error || !overview) return <ErrorNote>{error ?? "Market data is unavailable."}</ErrorNote>;

  const history = overview.index.history;

  return (
    <div>
      <PageHead title="Markets">
        <div className="flex flex-wrap items-center gap-3">
          <span className="mono-tight text-[11px] text-dim tnum">
            as of {date(overview.as_of)}, fetched {dateTime(overview.fetched_at)}
          </span>
          {!readOnly && <button onClick={startRefresh} disabled={refresh !== null} className="flex h-7 items-center gap-1.5 bg-white/[0.055] shadow-[inset_0_0_0_1px_rgb(255_255_255/0.09)] px-2.5 text-[12px] text-text transition-colors hover:bg-white/[0.04] disabled:text-dim">
            <ArrowsClockwise size={13} />
            {refresh ? "Refresh queued" : "Refresh prices"}
          </button>}
        </div>
      </PageHead>
      {refreshError && (
        <div className="mb-3">
          <ErrorNote>{refreshError}</ErrorNote>
        </div>
      )}
      {refresh && <p className="mb-2 text-[12px] text-dim">A new snapshot is being built from Yahoo Finance. Reload this page when it appears under Runs.</p>}

      <div className="mb-2 grid grid-cols-2 gap-x-6 gap-y-5 glass stat-enter px-4 py-4 md:grid-cols-4 xl:grid-cols-6">
        <Stat label="NIFTY 50" value={int(overview.index.last)} />
        {HORIZONS.slice(0, 4).map((h) => (
          <Stat key={h} label={`Index ${h}`} value={signedPct(overview.index.returns[h])} tone={overview.index.returns[h] >= 0 ? "em" : "loss"} />
        ))}
        <Stat label={`Breadth ${horizon}`} value={breadth ? `${breadth.up} up, ${breadth.down} down` : "n/a"} />
      </div>

      <div className="grid gap-2 xl:grid-cols-[minmax(0,1fr)_320px]">
        <Panel title="Constituents" aside={<Segmented value={horizon} onChange={setHorizon} options={HORIZONS.map((h) => ({ value: h, label: h }))} />}>
          <Treemap tiles={overview.tiles} horizon={horizon} selected={tile?.symbol ?? null} onSelect={setSelected} height={470} />
          <p className="border-t border-line px-3 py-2 text-[11px] text-dim">{overview.weight_note}</p>
        </Panel>

        <Panel title={tile?.symbol ?? "Selection"} aside={tile ? int(tile.last) : undefined}>
          {tile && (
            <div className="p-3">
              <p className="text-[14px] font-medium">{tile.name}</p>
              <p className="mt-0.5 text-[12px] text-dim">{tile.industry}</p>
              <div className="mt-4">
                <div className="label mb-2">Last 63 sessions</div>
                <Spark values={tile.spark} width={290} height={84} color={(tile.returns["3M"] ?? 0) >= 0 ? COLORS.em : COLORS.loss} />
              </div>
              <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3">
                {HORIZONS.map((h) => (
                  <div key={h} className="flex items-baseline justify-between gap-2">
                    <dt className="text-[12px] text-dim">{h}</dt>
                    <dd className={`mono-tight text-[12.5px] tnum ${(tile.returns[h] ?? 0) >= 0 ? "text-em" : "text-loss"}`}>{signedPct(tile.returns[h])}</dd>
                  </div>
                ))}
                <div className="flex items-baseline justify-between gap-2">
                  <dt className="text-[12px] text-dim">Weight</dt>
                  <dd className="mono-tight text-[12.5px] tnum">{pct(tile.weight)}</dd>
                </div>
                <div className="col-span-2 flex items-baseline justify-between gap-2">
                  <dt className="text-[12px] text-dim">Market cap (INR)</dt>
                  <dd className="mono-tight text-[12.5px] tnum">{compact(tile.market_cap)}</dd>
                </div>
              </dl>
            </div>
          )}
        </Panel>
      </div>

      <div className="mt-3 grid gap-2 lg:grid-cols-2 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <Panel title="NIFTY 50" aside="last 252 sessions">
          <LineChart
            height={320}
            series={[{ label: "NIFTY 50", color: COLORS.em, points: history.map((d, i) => [i, d.value]), width: 1.5 }]}
            xFormat={(v) => (history[Math.round(v)] ? date(history[Math.round(v)].date).slice(3) : "")}
            yFormat={(v) => int(v)}
          />
        </Panel>
        <Panel title="Correlation" aside={estimates ? `${estimates.tickers.length} largest, Ledoit-Wolf ${num(estimates.meta.shrinkage, 3)}` : undefined}>
          {estimates ? (
            <HeatMatrix matrix={estimates.corr} labels={estimates.tickers} height={290} caption={(i, j, v) => `${estimates.tickers[i]} x ${estimates.tickers[j]}: ${num(v, 2)}`} />
          ) : (
            <Skeleton className="m-3 h-72" />
          )}
        </Panel>
      </div>

      {quality && (
        <Panel
          className="mt-3"
          title="Data quality"
          aside={
            <button onClick={() => setOnlyIssues((v) => !v)} className="underline-offset-2 hover:underline">
              {onlyIssues ? `Show all ${quality.rows.length}` : "Show exceptions only"}
            </button>
          }
        >
          <div className="grid gap-x-8 gap-y-3 border-b border-line p-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Sessions" value={int(quality.sessions)} hint={`${date(quality.start)} to ${date(quality.end)}`} />
            <Stat label="Symbols" value={quality.rows.length} hint={quality.excluded.length ? `Excluded: ${quality.excluded.join(", ")}` : "None excluded"} />
            <Stat label="Snapshot hash" value={shortHash(quality.sha256)} hint="SHA-256 of the cleaned prices, checked on every load" />
            <Stat label="Source" value="Yahoo" hint={quality.source} />
          </div>
          <div className="max-h-72 overflow-auto">
            {qualityRows.length === 0 ? (
              <p className="p-4 text-[12.5px] text-dim">No exceptions. Every symbol has full history with no gaps, stale runs or outliers.</p>
            ) : (
              <table className="w-full">
                <thead>
                  <tr>
                    <Th align="left">Symbol</Th>
                    <Th>First date</Th>
                    <Th>Observations</Th>
                    <Th>Missing</Th>
                    <Th>Filled</Th>
                    <Th>Stale runs</Th>
                    <Th>Outliers</Th>
                  </tr>
                </thead>
                <tbody>
                  {qualityRows.map((r) => (
                    <tr key={r.symbol} className="border-t border-line">
                      <Td align="left">{r.symbol}</Td>
                      <Td>{date(r.first_date)}</Td>
                      <Td>{int(r.observations)}</Td>
                      <Td className={r.missing ? "text-gold" : ""}>{r.missing}</Td>
                      <Td>{r.filled}</Td>
                      <Td className={r.stale_runs ? "text-gold" : ""}>{r.stale_runs}</Td>
                      <Td className={r.outliers ? "text-gold" : ""}>{r.outliers}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </Panel>
      )}
    </div>
  );
}
