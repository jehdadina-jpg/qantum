"""Saves every API response the interface reads as a file, so the site can be hosted with no server.

Run after `VITE_STATIC=1 npm run build`: python -m qantum.export_static
"""

from __future__ import annotations

import json
import re
import shutil

from fastapi.testclient import TestClient

from .api import app
from .config import FRONTEND_DIST

KINDS = ["optimise", "risk", "simulate", "benchmark", "backtest", "refresh"]


def file_name(path: str) -> str:
    """Must match staticName in frontend/src/lib/api.ts."""
    return re.sub(r"[^A-Za-z0-9.-]+", "_", path.strip("/")) + ".json"


def main() -> None:
    target = FRONTEND_DIST / "data"
    shutil.rmtree(target, ignore_errors=True)
    target.mkdir(parents=True)
    client = TestClient(app)

    def save(path: str, body: object | None = None) -> object:
        if body is None:
            response = client.get(f"/api{path}")
            response.raise_for_status()
            body = response.json()
        (target / file_name(path)).write_text(json.dumps(body, separators=(",", ":")), encoding="utf-8")
        return body

    meta = client.get("/api/meta").json()
    save("/meta", {**meta, "read_only": True})
    save("/market/overview")
    save("/market/quality")
    save("/market/estimates?n=16")

    # Test runs made while developing are not part of the published record.
    runs = [run for run in client.get("/api/runs?limit=200").json()["runs"] if run["status"] == "finished" and not run["title"].startswith("N = ")]
    save("/runs?limit=200", {"runs": runs})
    for kind in KINDS:
        of_kind = [run for run in runs if run["kind"] == kind]
        save(f"/runs?kind={kind}&limit=60", {"runs": of_kind})
        save(f"/runs?limit=200&kind={kind}", {"runs": of_kind})
    save("/runs?kind=benchmark&status=finished&limit=1", {"runs": [run for run in runs if run["kind"] == "benchmark"][:1]})
    for run in runs:
        save(f"/runs/{run['id']}")
    latest = [run for run in runs if run["kind"] == "benchmark"]
    if latest:
        save("/runs/latest/benchmark", client.get(f"/api/runs/{latest[0]['id']}").json())

    for p in range(1, 6):
        save(f"/circuits/scaling?p={p}")
        for n in range(2, 17):
            for mixer in ("x", "xy"):
                save(f"/circuits/preview?n={n}&p={p}&mixer={mixer}")
    print(f"Saved {len(list(target.iterdir()))} responses, {len(runs)} runs")


if __name__ == "__main__":
    main()
