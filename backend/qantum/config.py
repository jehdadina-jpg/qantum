"""Runtime configuration. Everything has a working default; override with environment variables."""

from __future__ import annotations

import os
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parent.parent
PROJECT_ROOT = BACKEND_ROOT.parent

SNAPSHOT_DIR = Path(os.getenv("QANTUM_SNAPSHOT_DIR", BACKEND_ROOT / "data" / "snapshots"))
FRONTEND_DIST = Path(os.getenv("QANTUM_FRONTEND_DIST", PROJECT_ROOT / "frontend" / "dist"))

# SQLite keeps the project runnable with zero setup. Point this at PostgreSQL
# (see docker-compose.yml) to use the experiment store described in the proposal.
DATABASE_URL = os.getenv("QANTUM_DATABASE_URL", f"sqlite:///{BACKEND_ROOT / 'qantum.db'}")

# Annualised risk-free rate used for Sharpe ratios. A flat, stated assumption.
RISK_FREE_RATE = float(os.getenv("QANTUM_RISK_FREE", "0.06"))

TRADING_DAYS = 252

# Exact statevector enumeration limit for the fast kernel. 2^24 doubles is about 128 MiB.
MAX_EXACT_QUBITS = int(os.getenv("QANTUM_MAX_EXACT_QUBITS", "24"))

JOB_WORKERS = int(os.getenv("QANTUM_JOB_WORKERS", "2"))
SEED_ON_START = os.getenv("QANTUM_SEED_ON_START", "1") == "1"

IBM_TOKEN = os.getenv("QANTUM_IBM_TOKEN", "")
IBM_BACKEND = os.getenv("QANTUM_IBM_BACKEND", "")
