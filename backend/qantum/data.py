"""Module 1: financial data acquisition, cleaning and estimation.

Prices come from Yahoo Finance through yfinance (unofficial, research use only) and are
frozen into versioned, hashed snapshots so that every experiment traces to exact inputs.
"""

from __future__ import annotations

import gzip
import hashlib
import io
import json
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from datetime import datetime, timezone
from functools import lru_cache
from pathlib import Path
from zoneinfo import ZoneInfo

import numpy as np
import pandas as pd
from sklearn.covariance import LedoitWolf

from .config import SNAPSHOT_DIR, TRADING_DAYS

NSE_LIST_URL = "https://archives.nseindia.com/content/indices/ind_nifty50list.csv"
INDEX_TICKER = "^NSEI"
MAX_FILL_GAP = 3
STALE_RUN = 5
OUTLIER_LOG_RETURN = 0.25
MARKET_TIMEZONE = ZoneInfo("Asia/Kolkata")
MARKET_SETTLED_HOUR, MARKET_SETTLED_MINUTE = 16, 0  # NSE closes at 15:30 IST


def fetch_constituents() -> pd.DataFrame:
    """Current NIFTY 50 list from NSE, falling back to the copy saved with the last snapshot."""
    import requests

    try:
        response = requests.get(NSE_LIST_URL, headers={"User-Agent": "Mozilla/5.0"}, timeout=20)
        response.raise_for_status()
        frame = pd.read_csv(io.StringIO(response.text))
        return frame.rename(columns={"Company Name": "name", "Industry": "industry", "Symbol": "symbol"})[
            ["symbol", "name", "industry"]
        ]
    except Exception:
        meta = load_snapshot().meta
        return pd.DataFrame(
            [{"symbol": t["symbol"], "name": t["name"], "industry": t["industry"]} for t in meta["tickers"]]
        )


def _market_caps(symbols: list[str]) -> dict[str, float | None]:
    import yfinance as yf

    def one(symbol: str) -> tuple[str, float | None]:
        try:
            cap = yf.Ticker(f"{symbol}.NS").fast_info.get("marketCap")
            return symbol, float(cap) if cap else None
        except Exception:
            return symbol, None

    with ThreadPoolExecutor(max_workers=8) as pool:
        return dict(pool.map(one, symbols))


def clean_prices(close: pd.DataFrame) -> tuple[pd.DataFrame, dict[str, dict]]:
    """Align to the observed trading calendar, fill short gaps and report what was changed."""
    close = close.sort_index()
    close.index = pd.to_datetime(close.index).tz_localize(None).normalize()
    close = close[~close.index.duplicated(keep="last")]
    # A session is real if at least half the universe traded.
    close = close[close.notna().mean(axis=1) >= 0.5]

    cleaned = close.copy()
    report: dict[str, dict] = {}
    for col in close.columns:
        series = close[col]
        first = series.first_valid_index()
        if first is None:
            report[col] = {"observations": 0, "missing": 0, "filled": 0, "stale_runs": 0, "outliers": 0, "first_date": None}
            continue
        live = series.loc[first:]
        missing_before = int(live.isna().sum())
        filled = live.ffill(limit=MAX_FILL_GAP)
        cleaned.loc[first:, col] = filled
        unchanged = (live.diff() == 0).astype(int)
        runs = unchanged.groupby((unchanged == 0).cumsum()).sum()
        log_returns = np.log(filled / filled.shift(1)).dropna()
        report[col] = {
            "first_date": first.strftime("%Y-%m-%d"),
            "observations": int(live.notna().sum()),
            "missing": missing_before,
            "filled": missing_before - int(filled.isna().sum()),
            "stale_runs": int((runs >= STALE_RUN).sum()),
            "outliers": int((log_returns.abs() > OUTLIER_LOG_RETURN).sum()),
        }
    return cleaned, report


def drop_unfinished_session(close: pd.DataFrame, now: datetime | None = None) -> pd.DataFrame:
    """While NSE is open, Yahoo's newest row is a live price and not a close, so it is excluded."""
    now = now or datetime.now(MARKET_TIMEZONE)
    latest = pd.Timestamp(close.index[-1])
    latest = (latest.tz_convert(MARKET_TIMEZONE) if latest.tzinfo else latest).date()
    settled = now.hour > MARKET_SETTLED_HOUR or (now.hour == MARKET_SETTLED_HOUR and now.minute >= MARKET_SETTLED_MINUTE)
    return close.iloc[:-1] if latest >= now.date() and not settled else close


def build_snapshot(years: int = 6) -> dict:
    """Download, clean, hash and persist a new price snapshot. Returns its metadata."""
    import yfinance as yf

    constituents = fetch_constituents()
    symbols = constituents["symbol"].tolist()
    tickers = [f"{s}.NS" for s in symbols] + [INDEX_TICKER]
    raw = yf.download(tickers, period=f"{years}y", auto_adjust=True, progress=False, threads=True)
    close = raw["Close"].rename(columns=lambda c: c.removesuffix(".NS"))
    close = drop_unfinished_session(close)

    excluded = [s for s in symbols if s not in close or close[s].notna().sum() == 0]
    cleaned, report = clean_prices(close)

    csv_bytes = cleaned.round(4).to_csv(date_format="%Y-%m-%d").encode()
    digest = hashlib.sha256(csv_bytes).hexdigest()
    caps = _market_caps([s for s in symbols if s not in excluded])
    total_cap = sum(c for c in caps.values() if c)

    tickers_meta = []
    for row in constituents.itertuples():
        if row.symbol in excluded:
            continue
        cap = caps.get(row.symbol)
        tickers_meta.append(
            {
                "symbol": row.symbol,
                "name": row.name,
                "industry": row.industry,
                "market_cap": cap,
                "weight_proxy": (cap / total_cap) if cap and total_cap else None,
                **report[row.symbol],
            }
        )

    fetched_at = datetime.now(timezone.utc)
    snapshot_id = fetched_at.strftime("%Y%m%d-%H%M%S")
    meta = {
        "id": snapshot_id,
        "fetched_at": fetched_at.isoformat(),
        "start": cleaned.index[0].strftime("%Y-%m-%d"),
        "end": cleaned.index[-1].strftime("%Y-%m-%d"),
        "sessions": len(cleaned),
        "sha256": digest,
        "source": "Yahoo Finance via yfinance (adjusted close); constituents from NSE",
        "index": INDEX_TICKER,
        "index_report": report.get(INDEX_TICKER),
        "excluded": excluded,
        "tickers": tickers_meta,
    }

    SNAPSHOT_DIR.mkdir(parents=True, exist_ok=True)
    with gzip.open(SNAPSHOT_DIR / f"prices_{snapshot_id}.csv.gz", "wb") as handle:
        handle.write(csv_bytes)
    (SNAPSHOT_DIR / f"meta_{snapshot_id}.json").write_text(json.dumps(meta, indent=1))
    load_snapshot.cache_clear()
    return meta


@dataclass
class Snapshot:
    prices: pd.DataFrame
    meta: dict

    @property
    def symbols(self) -> list[str]:
        return [t["symbol"] for t in self.meta["tickers"]]

    @property
    def log_returns(self) -> pd.DataFrame:
        return np.log(self.prices[self.symbols] / self.prices[self.symbols].shift(1))

    @property
    def weights(self) -> dict[str, float]:
        return {t["symbol"]: t.get("weight_proxy") or 0.0 for t in self.meta["tickers"]}


def _latest_meta_path() -> Path:
    candidates = sorted(SNAPSHOT_DIR.glob("meta_*.json"))
    if not candidates:
        raise FileNotFoundError(f"No price snapshot in {SNAPSHOT_DIR}. Run: python -m qantum.data")
    return candidates[-1]


@lru_cache(maxsize=1)
def load_snapshot() -> Snapshot:
    meta_path = _latest_meta_path()
    meta = json.loads(meta_path.read_text())
    prices_path = meta_path.with_name(f"prices_{meta['id']}.csv.gz")
    with gzip.open(prices_path, "rb") as handle:
        csv_bytes = handle.read()
    if hashlib.sha256(csv_bytes).hexdigest() != meta["sha256"]:
        raise ValueError(f"Snapshot {meta['id']} failed its integrity check")
    prices = pd.read_csv(io.BytesIO(csv_bytes), index_col=0, parse_dates=True)
    return Snapshot(prices=prices, meta=meta)


@dataclass
class Estimates:
    tickers: list[str]
    mu: np.ndarray
    sigma: np.ndarray
    corr: np.ndarray
    vol: np.ndarray
    meta: dict = field(default_factory=dict)


def eligible_symbols(window: int, end: pd.Timestamp | None = None) -> list[str]:
    """Symbols with a complete return history over the estimation window ending at `end`."""
    snapshot = load_snapshot()
    returns = snapshot.log_returns
    if end is not None:
        returns = returns.loc[:end]
    tail = returns.tail(window)
    return [s for s in snapshot.symbols if tail[s].notna().all()]


def estimate(
    tickers: list[str],
    window: int = 252,
    end: pd.Timestamp | str | None = None,
    estimator: str = "ledoit_wolf",
    halflife: int = 63,
) -> Estimates:
    """Annualised (mu, Sigma) for a universe and window, equation (1) of the proposal."""
    snapshot = load_snapshot()
    returns = snapshot.log_returns[tickers]
    if end is not None:
        returns = returns.loc[: pd.Timestamp(end)]
    sample = returns.tail(window)
    if sample.isna().any().any():
        bad = sample.columns[sample.isna().any()].tolist()
        raise ValueError(f"Incomplete history in the {window}-day window for: {', '.join(bad)}")
    values = sample.to_numpy()

    delta = None
    if estimator == "ledoit_wolf":
        model = LedoitWolf().fit(values)
        daily, delta = model.covariance_, float(model.shrinkage_)
    elif estimator == "sample":
        daily = np.cov(values, rowvar=False)
    elif estimator == "ewma":
        decay = 0.5 ** (1 / halflife)
        weights = decay ** np.arange(len(values) - 1, -1, -1)
        weights /= weights.sum()
        centred = values - (weights[:, None] * values).sum(axis=0)
        daily = (weights[:, None] * centred).T @ centred
    else:
        raise ValueError(f"Unknown estimator {estimator!r}")

    mu = values.mean(axis=0) * TRADING_DAYS
    sigma = np.atleast_2d(daily) * TRADING_DAYS
    vol = np.sqrt(np.diag(sigma))
    corr = sigma / np.outer(vol, vol)
    return Estimates(
        tickers=list(tickers),
        mu=mu,
        sigma=sigma,
        corr=corr,
        vol=vol,
        meta={
            "window": window,
            "estimator": estimator,
            "shrinkage": delta,
            "start": sample.index[0].strftime("%Y-%m-%d"),
            "end": sample.index[-1].strftime("%Y-%m-%d"),
            "data_hash": snapshot.meta["sha256"],
            "snapshot": snapshot.meta["id"],
        },
    )


def select_universe(
    n: int,
    mode: str = "top_weight",
    seed: int = 7,
    tickers: list[str] | None = None,
    window: int = 252,
    end: pd.Timestamp | None = None,
) -> list[str]:
    eligible = eligible_symbols(window, end)
    if mode == "explicit":
        if not tickers:
            raise ValueError("An explicit universe needs a ticker list")
        missing = [t for t in tickers if t not in eligible]
        if missing:
            raise ValueError(f"No complete {window}-day history for: {', '.join(missing)}")
        return list(tickers)
    if n > len(eligible):
        raise ValueError(f"Only {len(eligible)} symbols have a complete {window}-day history")
    if mode == "random":
        rng = np.random.default_rng(seed)
        return [str(s) for s in rng.choice(eligible, size=n, replace=False)]
    weights = load_snapshot().weights
    return sorted(eligible, key=lambda s: -weights.get(s, 0))[:n]


if __name__ == "__main__":
    built = build_snapshot()
    print(f"Snapshot {built['id']}: {built['sessions']} sessions, {len(built['tickers'])} symbols, {built['sha256'][:12]}")
