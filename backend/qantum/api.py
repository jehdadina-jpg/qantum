"""FastAPI service layer. No authentication, by design for this stage of the project."""

from __future__ import annotations

from contextlib import asynccontextmanager
from functools import lru_cache
from typing import Literal

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, model_validator

from . import __version__, jobs, store
from .config import FRONTEND_DIST, IBM_TOKEN, MAX_EXACT_QUBITS, READ_ONLY, RISK_FREE_RATE, SEED_ON_START
from .data import eligible_symbols, estimate, load_snapshot, select_universe
from .formulation import PortfolioInstance, calibrate_penalty, ising
from .quantum.circuits import circuit_resources, gate_list, qaoa_circuit
from .simulation import REGIMES


@asynccontextmanager
async def lifespan(_: FastAPI):
    store.init_db()
    if SEED_ON_START:
        jobs.seed_reference_runs()
    yield


app = FastAPI(title="QANTUM", version=__version__, lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


@app.middleware("http")
async def block_writes_when_read_only(request: Request, call_next):
    if READ_ONLY and request.url.path.startswith("/api/") and request.method not in ("GET", "HEAD", "OPTIONS"):
        return JSONResponse({"detail": "This is a read-only demo. Run QANTUM locally to start experiments."}, status_code=403)
    return await call_next(request)


class QaoaSpec(BaseModel):
    p: int = Field(3, ge=1, le=8)
    mode: Literal["statevector", "shots", "mps", "noise", "ibm"] = "statevector"
    objective: Literal["mean", "cvar"] = "cvar"
    alpha: float = Field(0.2, gt=0, le=1)
    optimiser: Literal["COBYLA", "SPSA"] = "COBYLA"
    shots: int = Field(1024, ge=16, le=100_000)
    maxiter: int = Field(150, ge=10, le=5000)
    seed_points: int = Field(256, ge=8, le=4096)
    restarts: int = Field(3, ge=1, le=20)
    warm_start: bool = True
    mixer: Literal["x", "xy"] = "x"
    noise_scale: float = Field(1.0, ge=0, le=20)
    mps_bond: int = Field(16, ge=2, le=256)


class OptimiseSpec(BaseModel):
    n: int = Field(10, ge=2, le=50)
    K: int = Field(5, ge=1, le=50)
    q: float = Field(3.0, gt=0)
    penalty: float | None = Field(None, description="Leave empty for per-instance calibration")
    tc: float = Field(0.0, ge=0)
    window: int = Field(252, ge=60, le=1000)
    estimator: Literal["ledoit_wolf", "sample", "ewma"] = "ledoit_wolf"
    universe: Literal["top_weight", "random", "explicit"] = "top_weight"
    tickers: list[str] | None = None
    seed: int = 7
    compare_noise: bool = True
    noise_max_n: int = Field(10, ge=2, le=14)
    miqp_time_limit: float = Field(90, gt=0, le=1800)
    qaoa: QaoaSpec = QaoaSpec()

    @model_validator(mode="after")
    def check_sizes(self) -> "OptimiseSpec":
        if self.tickers:
            self.n = len(self.tickers)
        if self.K > self.n:
            raise ValueError("K cannot exceed the number of assets")
        if self.qaoa.mode != "mps" and self.n > MAX_EXACT_QUBITS:
            raise ValueError(f"N above {MAX_EXACT_QUBITS} needs the mps mode")
        return self


class RiskSpec(BaseModel):
    source_run: str | None = None
    portfolio: str | None = None
    tickers: list[str] | None = None
    alpha: float = Field(0.95, gt=0.5, lt=1)
    horizon_days: int = Field(1, ge=1, le=252)
    n_qubits: int = Field(5, ge=2, le=8)
    epsilon: float = Field(0.005, ge=0.0001, le=0.1)
    shots: int = Field(100, ge=10, le=5000)
    scenarios: int = Field(200_000, ge=1000, le=2_000_000)
    seed: int = 7
    include_noise: bool = True
    noise_scale: float = Field(1.0, ge=0, le=20)
    window: int = Field(252, ge=60, le=1000)


class SimulateSpec(BaseModel):
    source_run: str | None = None
    horizon_days: int = Field(63, ge=5, le=504)
    paths: int = Field(4000, ge=200, le=50_000)
    model: Literal["gbm", "bootstrap"] = "gbm"
    alpha: float = Field(0.95, gt=0.5, lt=1)
    seed: int = 7
    window: int = Field(252, ge=60, le=1000)


class BenchmarkRequest(BaseModel):
    sizes: list[int] = [6, 8, 10, 12]
    depths: list[int] = [1, 2, 3]
    instances: int = Field(5, ge=1, le=50)
    initialisations: int = Field(3, ge=1, le=20)
    objective: Literal["mean", "cvar"] = "cvar"
    alpha: float = Field(0.2, gt=0, le=1)
    optimiser: Literal["COBYLA", "SPSA"] = "COBYLA"
    shots: int = Field(1024, ge=16, le=100_000)
    maxiter: int = Field(120, ge=10, le=5000)
    seed_points: int = Field(128, ge=8, le=4096)
    q: float = Field(3.0, gt=0)
    include_noise: bool = False
    noise_max_n: int = Field(8, ge=2, le=12)
    noise_scale: float = Field(1.0, ge=0, le=20)
    small_k: bool = False
    seed: int = 2026


class BacktestRequest(BaseModel):
    n: int = Field(10, ge=2, le=20)
    K: int = Field(5, ge=1, le=20)
    q: float = Field(3.0, gt=0)
    window: int = Field(252, ge=60, le=1000)
    rebalance: int = Field(21, ge=5, le=126)
    years: float = Field(3.0, gt=0.25, le=5.0)
    transaction_bps: float = Field(10.0, ge=0, le=200)
    p: int = Field(2, ge=1, le=6)
    maxiter: int = Field(60, ge=10, le=1000)
    seed: int = 7
    universe: Literal["top_weight", "random", "explicit"] = "top_weight"
    tickers: list[str] | None = None


def _queue(kind: str, title: str, spec: dict) -> dict:
    try:
        run = jobs.submit(kind, title, spec)
    except (ValueError, FileNotFoundError) as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    return {"id": run.id, "kind": kind, "status": run.status, "title": title}


def _run_header(row) -> dict:
    header = {
        "id": row.id,
        "kind": row.kind,
        "status": row.status,
        "title": row.title,
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "finished_at": row.finished_at.isoformat() if row.finished_at else None,
        "spec": row.spec,
        "summary": row.summary,
        "error": row.error,
        "data_hash": row.data_hash,
        "versions": row.versions,
    }
    live = jobs.live_state(row.id)
    if live:
        header["progress"] = live["progress"]
        header["message"] = live["message"]
    return header


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok", "version": __version__}


@app.get("/api/meta")
def meta() -> dict:
    snapshot = load_snapshot().meta
    return {
        "version": __version__,
        "read_only": READ_ONLY,
        "snapshot": {k: snapshot[k] for k in ("id", "fetched_at", "start", "end", "sessions", "sha256", "source", "excluded")},
        "symbols": len(snapshot["tickers"]),
        "risk_free": RISK_FREE_RATE,
        "max_exact_qubits": MAX_EXACT_QUBITS,
        "versions": store.library_versions(),
        "backends": [
            {"id": "statevector", "label": "Exact statevector", "available": True},
            {"id": "shots", "label": "Aer, ideal shots", "available": True},
            {"id": "noise", "label": "Aer, noise model", "available": True},
            {"id": "mps", "label": "Aer, matrix product state", "available": True},
            {"id": "ibm", "label": "IBM Quantum hardware", "available": bool(IBM_TOKEN)},
        ],
        "regimes": REGIMES,
    }


@lru_cache(maxsize=4)
def _overview(snapshot_id: str) -> dict:
    snapshot = load_snapshot()
    prices = snapshot.prices
    tiles = []
    horizons = {"1D": 1, "1W": 5, "1M": 21, "3M": 63, "1Y": 252}
    for ticker in snapshot.meta["tickers"]:
        series = prices[ticker["symbol"]].dropna()
        last = float(series.iloc[-1])
        returns = {
            label: float(last / series.iloc[-steps - 1] - 1) if len(series) > steps else None
            for label, steps in horizons.items()
        }
        tiles.append(
            {
                "symbol": ticker["symbol"],
                "name": ticker["name"],
                "industry": ticker["industry"],
                "last": last,
                "returns": returns,
                "weight": ticker.get("weight_proxy"),
                "market_cap": ticker.get("market_cap"),
                "spark": [round(float(v), 2) for v in series.tail(63)],
            }
        )
    index_series = prices[snapshot.meta["index"]].dropna()
    return {
        "as_of": snapshot.meta["end"],
        "fetched_at": snapshot.meta["fetched_at"],
        "index": {
            "symbol": "NIFTY 50",
            "last": float(index_series.iloc[-1]),
            "returns": {
                label: float(index_series.iloc[-1] / index_series.iloc[-steps - 1] - 1) for label, steps in horizons.items() if len(index_series) > steps
            },
            "history": [
                {"date": d.strftime("%Y-%m-%d"), "value": round(float(v), 2)} for d, v in index_series.tail(252).items()
            ],
        },
        "weight_note": "Tile size uses each constituent's share of total market cap, a proxy for the free-float index weight.",
        "tiles": tiles,
    }


@app.get("/api/market/overview")
def market_overview() -> dict:
    return _overview(load_snapshot().meta["id"])


@app.get("/api/market/quality")
def market_quality() -> dict:
    snapshot = load_snapshot().meta
    return {
        "snapshot": snapshot["id"],
        "sha256": snapshot["sha256"],
        "source": snapshot["source"],
        "sessions": snapshot["sessions"],
        "start": snapshot["start"],
        "end": snapshot["end"],
        "excluded": snapshot["excluded"],
        "rows": [
            {k: t.get(k) for k in ("symbol", "name", "first_date", "observations", "missing", "filled", "stale_runs", "outliers")}
            for t in snapshot["tickers"]
        ],
    }


@app.get("/api/market/estimates")
def market_estimates(
    n: int = Query(12, ge=2, le=50),
    window: int = Query(252, ge=60, le=1000),
    estimator: Literal["ledoit_wolf", "sample", "ewma"] = "ledoit_wolf",
) -> dict:
    tickers = select_universe(n, window=window)
    result = estimate(tickers, window=window, estimator=estimator)
    return store.jsonable(
        {"tickers": tickers, "mu": result.mu, "vol": result.vol, "corr": result.corr, "meta": result.meta}
    )


@app.post("/api/market/refresh")
def market_refresh() -> dict:
    return _queue("refresh", "Refresh prices from Yahoo Finance", {"years": 6})


@app.get("/api/universe")
def universe(window: int = Query(252, ge=60, le=1000)) -> dict:
    snapshot = load_snapshot()
    eligible = set(eligible_symbols(window))
    return {
        "symbols": [
            {"symbol": t["symbol"], "name": t["name"], "industry": t["industry"], "weight": t.get("weight_proxy"), "eligible": t["symbol"] in eligible}
            for t in sorted(snapshot.meta["tickers"], key=lambda t: -(t.get("weight_proxy") or 0))
        ]
    }


@app.post("/api/runs/optimise")
def create_optimise(spec: OptimiseSpec) -> dict:
    title = f"N = {spec.n}, K = {spec.K}, p = {spec.qaoa.p}, {spec.qaoa.mode}, {spec.qaoa.objective}"
    return _queue("optimise", title, spec.model_dump())


@app.post("/api/runs/risk")
def create_risk(spec: RiskSpec) -> dict:
    title = f"VaR and CVaR at {spec.alpha:.0%}, {spec.horizon_days}d horizon, {spec.n_qubits} qubits"
    return _queue("risk", title, spec.model_dump())


@app.post("/api/runs/simulate")
def create_simulate(spec: SimulateSpec) -> dict:
    return _queue("simulate", f"{spec.model.upper()} stress test, {spec.horizon_days} sessions", spec.model_dump())


@app.post("/api/runs/benchmark")
def create_benchmark(spec: BenchmarkRequest) -> dict:
    sizes = ", ".join(map(str, spec.sizes))
    return _queue("benchmark", f"Benchmark N in {{{sizes}}}, {spec.instances} instances", spec.model_dump())


@app.post("/api/runs/backtest")
def create_backtest(spec: BacktestRequest) -> dict:
    return _queue("backtest", f"Walk-forward N = {spec.n}, K = {spec.K}, {spec.years:g} years", spec.model_dump())


@app.get("/api/runs")
def runs(kind: str | None = None, status: str | None = None, limit: int = Query(100, ge=1, le=500)) -> dict:
    return {"runs": [_run_header(row) for row in store.list_runs(kind, status, limit)]}


@app.get("/api/runs/latest/{kind}")
def latest_run(kind: str) -> dict:
    run = store.latest_finished(kind)
    if not run:
        raise HTTPException(status_code=404, detail=f"No finished {kind} run yet")
    return {**_run_header(run), "result": run.result}


@app.get("/api/runs/{run_id}")
def run_detail(run_id: str) -> dict:
    run = store.get_run(run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    live = jobs.live_state(run_id)
    return {**_run_header(run), "result": run.result, "partial": live["partial"] if live else None}


@app.delete("/api/runs/{run_id}")
def run_delete(run_id: str) -> dict:
    if jobs.live_state(run_id):
        raise HTTPException(status_code=409, detail="This run is still in progress")
    if not store.delete_run(run_id):
        raise HTTPException(status_code=404, detail="Run not found")
    return {"deleted": run_id}


@lru_cache(maxsize=64)
def _circuit_preview(n: int, p: int, mixer: str, K: int, q: float, snapshot_id: str) -> dict:
    tickers = select_universe(n)
    estimates = estimate(tickers)
    instance = PortfolioInstance(tickers, estimates.mu, estimates.sigma, K=K, q=q)
    instance.penalty = calibrate_penalty(instance)["penalty"]
    Q, constant = instance.qubo()
    h, J, _ = ising(Q, constant)
    circuit = qaoa_circuit(h, J, p, mixer=mixer)
    return store.jsonable(
        {
            "tickers": tickers,
            "n": n,
            "p": p,
            "K": K,
            "mixer": mixer,
            "penalty": instance.penalty,
            "resources": circuit_resources(circuit),
            "drawing": gate_list(circuit),
            "statevector_memory_bytes": 16 * 2**n,
        }
    )


@app.get("/api/circuits/preview")
def circuit_preview(
    n: int = Query(6, ge=2, le=20),
    p: int = Query(1, ge=1, le=6),
    mixer: Literal["x", "xy"] = "x",
    K: int | None = Query(None, ge=1, le=20),
    q: float = 3.0,
) -> dict:
    cardinality = K if K is not None else max(n // 2, 1)
    if cardinality > n:
        raise HTTPException(status_code=422, detail="K cannot exceed N")
    return _circuit_preview(n, p, mixer, cardinality, q, load_snapshot().meta["id"])


@lru_cache(maxsize=16)
def _scaling(p: int, snapshot_id: str) -> dict:
    rows = []
    for n in (4, 6, 8, 10, 12, 14, 16, 20):
        tickers = select_universe(n)
        estimates = estimate(tickers)
        instance = PortfolioInstance(tickers, estimates.mu, estimates.sigma, K=n // 2, q=3.0, penalty=1.0)
        Q, constant = instance.qubo()
        h, J, _ = ising(Q, constant)
        resources = circuit_resources(qaoa_circuit(h, J, p))
        rows.append(
            {
                "n": n,
                "logical_two_qubit": resources["logical_two_qubit"],
                "depth": resources["all_to_all"]["depth"],
                "two_qubit": resources["all_to_all"]["two_qubit_gates"],
                "routed_depth": resources["heavy_hex"]["depth"],
                "routed_two_qubit": resources["heavy_hex"]["two_qubit_gates"],
                "esp_all_to_all": resources["all_to_all"]["esp"],
                "esp_heavy_hex": resources["heavy_hex"]["esp"],
            }
        )
    encoding = [{"n_assets": n, **{f"b{b}": n * b for b in (1, 2, 3, 4)}} for n in range(2, 51, 2)]
    return store.jsonable({"p": p, "rows": rows, "encoding": encoding, "statevector_limit_qubits": 30})


@app.get("/api/circuits/scaling")
def circuit_scaling(p: int = Query(1, ge=1, le=5)) -> dict:
    return _scaling(p, load_snapshot().meta["id"])


if FRONTEND_DIST.exists():
    app.mount("/assets", StaticFiles(directory=FRONTEND_DIST / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str) -> FileResponse:
        # public/ is checked too, so team photos appear on reload without rebuilding the interface.
        for root in (FRONTEND_DIST.resolve(), FRONTEND_DIST.parent.resolve() / "public"):
            candidate = (root / path).resolve()
            if path and candidate.is_file() and candidate.is_relative_to(root):
                return FileResponse(candidate)
        if path.startswith(("team/", "api/")):
            raise HTTPException(status_code=404, detail="Not found")
        return FileResponse(FRONTEND_DIST / "index.html")


