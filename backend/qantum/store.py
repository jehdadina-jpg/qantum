"""Experiment store. Each run keeps its spec, inputs hash, seed, library versions and full result."""

from __future__ import annotations

import math
from datetime import datetime, timezone
from importlib.metadata import PackageNotFoundError, version
from uuid import uuid4

import numpy as np
from sqlalchemy import JSON, DateTime, String, Text, create_engine, select
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, sessionmaker

from .config import DATABASE_URL

connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}
engine = create_engine(DATABASE_URL, connect_args=connect_args, pool_pre_ping=True)
SessionLocal = sessionmaker(engine, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


class Run(Base):
    __tablename__ = "runs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    kind: Mapped[str] = mapped_column(String(24), index=True)
    status: Mapped[str] = mapped_column(String(16), index=True)
    title: Mapped[str] = mapped_column(String(160))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    spec: Mapped[dict] = mapped_column(JSON)
    summary: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    result: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    data_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    versions: Mapped[dict | None] = mapped_column(JSON, nullable=True)


def init_db() -> None:
    Base.metadata.create_all(engine)
    # A run cannot survive a process restart, so anything still open was interrupted.
    with SessionLocal.begin() as session:
        for run in session.scalars(select(Run).where(Run.status.in_(("queued", "running")))):
            run.status = "interrupted"
            run.error = "The server restarted before this run finished."


def library_versions() -> dict[str, str]:
    versions = {}
    for package in ("qiskit", "qiskit-aer", "numpy", "scipy", "scikit-learn", "pandas"):
        try:
            versions[package] = version(package)
        except PackageNotFoundError:
            versions[package] = "unknown"
    return versions


def jsonable(value):
    """Convert numpy types and non-finite floats, which JSON columns and responses reject."""
    if isinstance(value, dict):
        return {str(k): jsonable(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [jsonable(v) for v in value]
    if isinstance(value, np.ndarray):
        return jsonable(value.tolist())
    if isinstance(value, np.generic):
        return jsonable(value.item())
    if isinstance(value, float) and not math.isfinite(value):
        return None
    return value


def create_run(kind: str, title: str, spec: dict, data_hash: str | None) -> Run:
    run = Run(
        id=str(uuid4()),
        kind=kind,
        status="queued",
        title=title,
        created_at=datetime.now(timezone.utc),
        spec=jsonable(spec),
        data_hash=data_hash,
        versions=library_versions(),
    )
    with SessionLocal.begin() as session:
        session.add(run)
    return run


def update_run(run_id: str, **fields) -> None:
    with SessionLocal.begin() as session:
        run = session.get(Run, run_id)
        if run:
            for key, value in fields.items():
                setattr(run, key, jsonable(value) if key in ("result", "summary") else value)


def get_run(run_id: str) -> Run | None:
    with Session(engine) as session:
        return session.get(Run, run_id)


def list_runs(kind: str | None = None, status: str | None = None, limit: int = 100) -> list[Run]:
    # Only the columns needed for a listing, so large result documents stay out of memory.
    columns = (Run.id, Run.kind, Run.status, Run.title, Run.created_at, Run.finished_at, Run.spec, Run.summary, Run.error, Run.data_hash, Run.versions)
    query = select(*columns).order_by(Run.created_at.desc()).limit(limit)
    if kind:
        query = query.where(Run.kind == kind)
    if status:
        query = query.where(Run.status == status)
    with Session(engine) as session:
        return list(session.execute(query).all())


def delete_run(run_id: str) -> bool:
    with SessionLocal.begin() as session:
        run = session.get(Run, run_id)
        if not run:
            return False
        session.delete(run)
    return True


def latest_finished(kind: str) -> Run | None:
    query = select(Run).where(Run.kind == kind, Run.status == "finished").order_by(Run.created_at.desc()).limit(1)
    with Session(engine) as session:
        return session.scalars(query).first()


def count_runs() -> int:
    with Session(engine) as session:
        return len(session.execute(select(Run.id).limit(1)).all())
