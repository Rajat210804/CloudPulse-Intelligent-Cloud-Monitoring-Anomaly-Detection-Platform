import random
from datetime import datetime, timedelta, timezone
from unittest.mock import Mock

import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from aws_agent import latest_cpu


@pytest.fixture
def client(tmp_path):
    app = create_app(f"sqlite:///{tmp_path / 'test.db'}", api_key="")
    with TestClient(app) as session:
        yield session


def test_dashboard_and_health(client):
    assert client.get("/api/health").json() == {"status": "ok", "database": "connected"}
    assert "CloudPulse" in client.get("/").text
    assert client.get("/static/dashboard.js").status_code == 200


def test_history_and_alerts_stay_with_their_server(client):
    normal = client.post("/api/metrics", json={"server": "web-1", "cpu": 25})
    spike = client.post("/api/metrics", json={"server": "web-2", "cpu": 98})
    assert normal.status_code == spike.status_code == 201
    assert normal.json()["memory"] is None
    assert not normal.json()["anomaly"]
    assert spike.json()["anomaly"]
    assert spike.json()["reason"] == "Cpu usage reached 98.0%"
    assert client.get("/api/servers").json() == ["web-1", "web-2"]
    assert len(client.get("/api/metrics?server=web-1").json()) == 1
    assert client.get("/api/alerts?server=web-1").json() == []
    assert len(client.get("/api/alerts?server=web-2").json()) == 1
    assert client.get("/api/metrics?limit=1").json()[0]["server"] == "web-2"


@pytest.mark.parametrize("payload", [
    {"server": "web", "cpu": 101},
    {"server": "web", "cpu": -1},
    {"server": "web", "cpu": 20, "memory": 150},
    {"server": "", "cpu": 20},
    {"server": "<script>", "cpu": 20},
    {"server": "web"},
])
def test_bad_readings_are_rejected(client, payload):
    assert client.post("/api/metrics", json=payload).status_code == 422
    assert client.get("/api/metrics").json() == []


def test_model_detects_a_spike_below_the_fixed_limit(client):
    randomizer = random.Random(7)
    for _ in range(35):
        response = client.post("/api/metrics", json={
            "server": "steady", "cpu": randomizer.uniform(20, 30),
            "memory": randomizer.uniform(40, 50), "disk": randomizer.uniform(25, 30),
        })
        assert response.status_code == 201
    spike = client.post("/api/metrics", json={
        "server": "steady", "cpu": 80, "memory": 80, "disk": 80,
    }).json()
    assert spike["anomaly"]
    assert "Unusual" in spike["reason"]
    fresh = client.post("/api/metrics", json={"server": "new", "cpu": 80}).json()
    assert not fresh["anomaly"]


def test_api_key_and_data_survive_restart(tmp_path):
    url = f"sqlite:///{tmp_path / 'saved.db'}"
    with TestClient(create_app(url, api_key="test-only-key")) as client:
        reading = {"server": "web", "cpu": 95}
        assert client.post("/api/metrics", json=reading).status_code == 401
        response = client.post("/api/metrics", json=reading, headers={"X-API-Key": "test-only-key"})
        assert response.status_code == 201
    with TestClient(create_app(url, api_key="test-only-key")) as client:
        rows = client.get("/api/metrics").json()
        assert len(rows) == 1
        assert rows[0]["cpu"] == 95
        assert rows[0]["created_at"].endswith("+00:00")
        assert len(client.get("/api/alerts").json()) == 1


def test_cloudwatch_uses_latest_point_and_handles_missing_data():
    now = datetime.now(timezone.utc)
    newest = {"Timestamp": now, "Average": 23}
    cloudwatch = Mock()
    cloudwatch.get_metric_statistics.return_value = {"Datapoints": [
        newest, {"Timestamp": now - timedelta(minutes=5), "Average": 19},
    ]}
    assert latest_cpu(cloudwatch, "i-123") == newest
    options = cloudwatch.get_metric_statistics.call_args.kwargs
    assert options["Dimensions"] == [{"Name": "InstanceId", "Value": "i-123"}]
    assert options["MetricName"] == "CPUUtilization"
    cloudwatch.get_metric_statistics.return_value = {"Datapoints": []}
    assert latest_cpu(cloudwatch, "i-123") is None
