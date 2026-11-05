"""End-to-end through the REST API on the real snapshot: submit, run, store, read back."""

import time

import pytest
from fastapi.testclient import TestClient

from qantum.api import app


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as test_client:
        yield test_client


def wait(client, run_id, limit=240):
    deadline = time.time() + limit
    while time.time() < deadline:
        body = client.get(f"/api/runs/{run_id}").json()
        if body["status"] in ("finished", "failed"):
            return body
        time.sleep(0.2)
    raise AssertionError("Run did not finish in time")


def test_meta_and_market(client):
    meta = client.get("/api/meta").json()
    assert meta["symbols"] == 50
    assert len(meta["snapshot"]["sha256"]) == 64
    overview = client.get("/api/market/overview").json()
    assert len(overview["tiles"]) == 50
    assert overview["index"]["last"] > 0
    assert client.get("/api/market/quality").json()["sessions"] > 1000


def test_optimise_run_records_everything_needed_to_reproduce_it(client):
    spec = {"n": 6, "K": 3, "seed": 3, "qaoa": {"p": 2, "maxiter": 40, "seed_points": 32, "restarts": 1, "shots": 512}}
    created = client.post("/api/runs/optimise", json=spec).json()
    body = wait(client, created["id"])
    assert body["status"] == "finished", body["error"]
    assert len(body["data_hash"]) == 64
    assert body["versions"]["qiskit"]
    result = body["result"]
    labels = [row["label"] for row in result["portfolios"]]
    assert labels[:3] == ["Exact MIQP", "Brute force", "Simulated annealing"]
    assert "QAOA p=2" in labels and "QAOA p=2 + noise" in labels
    by_label = {row["label"]: row for row in result["portfolios"]}
    assert by_label["Exact MIQP"]["objective"] == pytest.approx(by_label["Brute force"]["objective"], abs=1e-9)
    assert by_label["QAOA p=2"]["gap"] >= 0
    assert by_label["QAOA p=2"]["depth"] > 0
    assert len(result["cloud"]) == 20
    assert result["qaoa"]["landscape"]["energy"]


def test_bad_spec_is_rejected_with_a_clear_error(client):
    response = client.post("/api/runs/optimise", json={"n": 6, "K": 9})
    assert response.status_code == 422


def test_circuit_preview(client):
    preview = client.get("/api/circuits/preview", params={"n": 4, "p": 1}).json()
    assert preview["resources"]["logical_two_qubit"] == 6
    assert preview["drawing"]["qubits"] == 4


def test_unknown_run_is_a_404(client):
    assert client.get("/api/runs/nope").status_code == 404
