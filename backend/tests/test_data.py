"""O1: the data pipeline, on synthetic frames with known defects and on the real snapshot."""

from datetime import datetime

import numpy as np
import pandas as pd
import pytest

from qantum.data import MARKET_TIMEZONE, clean_prices, drop_unfinished_session, estimate, load_snapshot, select_universe


def frame(days=20):
    index = pd.bdate_range("2026-01-01", periods=days)
    return pd.DataFrame({"AAA": np.linspace(100, 120, days), "BBB": np.linspace(50, 40, days)}, index=index)


def test_short_gaps_are_filled_and_reported():
    prices = frame()
    prices.iloc[5:7, 0] = np.nan
    cleaned, report = clean_prices(prices)
    assert cleaned["AAA"].notna().all()
    assert report["AAA"]["missing"] == 2 and report["AAA"]["filled"] == 2


def test_long_gaps_are_not_invented():
    prices = frame()
    prices.iloc[5:12, 0] = np.nan
    cleaned, report = clean_prices(prices)
    assert cleaned["AAA"].isna().sum() == 4
    assert report["AAA"]["filled"] == 3


def test_stale_runs_and_outliers_are_flagged_and_kept():
    prices = frame()
    prices.iloc[3:10, 1] = 45.0
    prices.iloc[15:, 0] = prices.iloc[15:, 0] * 2
    cleaned, report = clean_prices(prices)
    assert report["BBB"]["stale_runs"] == 1
    assert report["AAA"]["outliers"] == 1
    assert cleaned.iloc[15, 0] == prices.iloc[15, 0]


def test_pre_listing_history_stays_empty():
    prices = frame()
    prices.iloc[:8, 1] = np.nan
    cleaned, report = clean_prices(prices)
    assert cleaned["BBB"].iloc[:8].isna().all()
    assert report["BBB"]["first_date"] == prices.index[8].strftime("%Y-%m-%d")


def test_live_session_is_dropped_only_while_the_market_is_open():
    prices = frame(5)
    last = prices.index[-1]
    during = datetime(last.year, last.month, last.day, 11, 26, tzinfo=MARKET_TIMEZONE)
    after = datetime(last.year, last.month, last.day, 16, 5, tzinfo=MARKET_TIMEZONE)
    assert len(drop_unfinished_session(prices, during)) == 4
    assert len(drop_unfinished_session(prices, after)) == 5


def test_snapshot_is_real_and_hash_verified():
    snapshot = load_snapshot()
    assert len(snapshot.symbols) == 50
    assert len(snapshot.meta["sha256"]) == 64


@pytest.mark.parametrize("estimator", ["ledoit_wolf", "sample", "ewma"])
def test_estimates_are_valid_covariances(estimator):
    tickers = select_universe(12)
    result = estimate(tickers, estimator=estimator)
    assert np.allclose(result.sigma, result.sigma.T)
    assert np.linalg.eigvalsh(result.sigma).min() > 0
    assert np.allclose(np.diag(result.corr), 1)
    assert result.meta["data_hash"] == load_snapshot().meta["sha256"]


def test_incomplete_history_is_refused():
    with pytest.raises(ValueError, match="complete"):
        select_universe(3, mode="explicit", tickers=["JIOFIN", "RELIANCE", "TCS"], window=1400)
