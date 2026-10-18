# CloudPulse

### Intelligent Cloud Monitoring & Anomaly Detection Platform

A small project I built to make server health easier to follow. CloudPulse saves resource readings, spots unusual activity with Isolation Forest, and brings everything together in one dashboard.

Built with Python, FastAPI, PostgreSQL, Docker, Scikit-learn, and AWS CloudWatch. The dashboard uses plain HTML, CSS, and JavaScript.

![CloudPulse dashboard showing demo readings](docs/dashboard.png)

## Try it locally

Use Python 3.12. This quick setup uses SQLite, so you can try the app without a database server.

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

Open `http://localhost:8000`. The API docs live at `/docs`.

In another terminal, activate the same environment and run `python demo.py` for sample data, or `python agent.py` to monitor your machine. Demo readings belong to `demo.server` and include a CPU spike. Run the collector on the host to measure the host, rather than inside an app container.

## Run with PostgreSQL

Copy `.env.example` to `.env` and fill in `POSTGRES_PASSWORD` with a URL safe password. A random hex string works well. Then run:

```bash
docker compose up --build -d
```

The app uses PostgreSQL here, and readings stay in a Docker volume. Use `docker compose down` to stop it without deleting your data. SQLite and PostgreSQL keep separate histories. Compose reads `.env`; Python commands use variables exported in your terminal.

## Connect AWS

With an AWS role or local AWS profile that allows `cloudwatch:GetMetricStatistics`, run:

```bash
python aws_agent.py i-YOUR_INSTANCE_ID --region us-east-1
```

This reads EC2 CPU averages every five minutes and checks for new data every minute. Memory and disk stay blank because EC2 does not publish those by default. The chart records when CloudPulse receives each reading. The regular agent also works directly on an EC2 host.

## How alerts work

Usage at 90% or above creates an alert immediately. After 30 readings, Isolation Forest also checks each new reading against up to 200 previous readings from that server. Alerts are saved in the database and shown in the dashboard. Email and SMS are not included.

This is a learning project. The model can flag harmless changes, so treat its alerts as a reason to investigate.

## API and tests

Send readings to `POST /api/metrics` with `server`, `cpu`, and optional `memory` and `disk` percentages. Read history at `GET /api/metrics?server=web-1`, alerts at `/api/alerts`, and database health at `/api/health`. History returns the latest 120 readings by default, or up to 500 with `limit`.

```bash
python -m pytest -q
```

Set `CLOUDPULSE_URL` when a collector runs on another machine. Set the same `API_KEY` on the app and collectors to protect metric uploads. The dashboard and read APIs are public by design, and Docker binds to your local machine. Before sharing it online, add HTTPS and authentication for all routes. No AWS credentials belong in this repository.
