import { useCallback, useEffect, useRef, useState } from "react";
import { api, post, type Meta, type Run, type RunHeader, type RunKind } from "./api";

let readOnlyRequest: Promise<boolean> | null = null;

/** Whether this server is a read-only demo. Asked once per page load. */
export function useReadOnly() {
  const [readOnly, setReadOnly] = useState(false);
  useEffect(() => {
    readOnlyRequest ??= api<Meta>("/meta").then((meta) => meta.read_only).catch(() => false);
    void readOnlyRequest.then(setReadOnly);
  }, []);
  return readOnly;
}

export function useFetch<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(path !== null);

  useEffect(() => {
    if (path === null) return;
    let active = true;
    setLoading(true);
    api<T>(path)
      .then((value) => {
        if (active) {
          setData(value);
          setError(null);
        }
      })
      .catch((reason: Error) => {
        if (active) setError(reason.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [path]);

  return { data, error, loading };
}

/** Tracks the width and height of a chart container without re-rendering on scroll. */
export function useSize<E extends HTMLElement>() {
  const ref = useRef<E | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    if (!ref.current) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize({ width, height });
    });
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  return [ref, size] as const;
}

const POLL_MS = 600;
const IDLE_POLL_MS = 15000;

/** Same runs in the same state: keeping the old array lets React skip re-rendering the page. */
export function sameRuns(a: RunHeader[], b: RunHeader[]) {
  return a.length === b.length && a.every((run, i) => run.id === b[i].id && run.status === b[i].status && run.progress === b[i].progress && run.message === b[i].message);
}

/**
 * Everything a terminal page needs from the experiment store: run history, the selected run,
 * and live progress for whichever run is in flight.
 */
export function useExperiment<T>(kind: RunKind) {
  const [runs, setRuns] = useState<RunHeader[]>([]);
  const [run, setRun] = useState<Run<T> | null>(null);
  const [active, setActive] = useState<Run<T> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const selectedId = useRef<string | null>(null);

  const refreshList = useCallback(async () => {
    const { runs: list } = await api<{ runs: RunHeader[] }>(`/runs?kind=${kind}&limit=60`);
    setRuns((previous) => (sameRuns(previous, list) ? previous : list));
    return list;
  }, [kind]);

  const select = useCallback(async (id: string) => {
    selectedId.current = id;
    const detail = await api<Run<T>>(`/runs/${id}`);
    if (selectedId.current === id) setRun(detail);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    const tick = async () => {
      if (document.hidden && selectedId.current) {
        timer = setTimeout(tick, IDLE_POLL_MS);
        return;
      }
      try {
        const list = await refreshList();
        if (cancelled) return;
        setError(null);
        const inFlight = list.find((r) => r.status === "running" || r.status === "queued");
        if (inFlight) {
          const detail = await api<Run<T>>(`/runs/${inFlight.id}`);
          if (!cancelled) setActive(detail);
        } else {
          setActive((previous) => {
            // A run just finished: bring its result on screen.
            if (previous) {
              const finished = list.find((r) => r.id === previous.id);
              if (finished?.status === "finished" || finished?.status === "failed") void select(previous.id);
            }
            return null;
          });
        }
        if (!selectedId.current) {
          const latest = list.find((r) => r.status === "finished");
          if (latest) await select(latest.id);
        }
        if (!cancelled) setLoading(false);
        timer = setTimeout(tick, inFlight ? POLL_MS : IDLE_POLL_MS);
      } catch (reason) {
        if (cancelled) return;
        setError((reason as Error).message);
        setLoading(false);
        timer = setTimeout(tick, IDLE_POLL_MS);
      }
    };

    void tick();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [refreshList, select]);

  const submit = useCallback(
    async (spec: unknown) => {
      setError(null);
      try {
        const created = await post<RunHeader>(`/runs/${kind}`, spec);
        selectedId.current = created.id;
        await refreshList();
        const detail = await api<Run<T>>(`/runs/${created.id}`);
        setActive(detail);
      } catch (reason) {
        setError((reason as Error).message);
      }
    },
    [kind, refreshList],
  );

  return { runs, run, active, error, loading, select, submit };
}
