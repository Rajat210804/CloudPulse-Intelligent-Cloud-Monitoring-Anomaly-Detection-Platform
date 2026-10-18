import os
import secrets
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path

from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ConfigDict, Field, field_serializer
from sqlalchemy import Boolean, DateTime, Float, String, create_engine, select, text
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column

from app.detection import find_anomaly


class Base(DeclarativeBase):
    pass


class Metric(Base):
    __tablename__ = "metrics"

    id: Mapped[int] = mapped_column(primary_key=True)
    server: Mapped[str] = mapped_column(String(80), index=True)
    cpu: Mapped[float] = mapped_column(Float)
    memory: Mapped[float | None] = mapped_column(Float, nullable=True)
    disk: Mapped[float | None] = mapped_column(Float, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    anomaly: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    reason: Mapped[str | None] = mapped_column(String(200), nullable=True)


class Reading(BaseModel):
    server: str = Field(min_length=1, max_length=80, pattern=r"^[a-zA-Z0-9_.:-]+$")
    cpu: float = Field(ge=0, le=100, allow_inf_nan=False)
    memory: float | None = Field(default=None, ge=0, le=100, allow_inf_nan=False)
    disk: float | None = Field(default=None, ge=0, le=100, allow_inf_nan=False)


class MetricView(Reading):
    model_config = ConfigDict(from_attributes=True)
    id: int
    created_at: datetime
    anomaly: bool
    reason: str | None

    @field_serializer("created_at")
    def utc_timestamp(self, value):
        if value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc).isoformat()


def database(request: Request):
    with Session(request.app.state.engine) as session:
        yield session


def require_key(request: Request, x_api_key: str = Header(default="")):
    expected = request.app.state.api_key
    if expected and not secrets.compare_digest(x_api_key.encode(), expected.encode()):
        raise HTTPException(status_code=401, detail="A valid API key is required")


def create_app(database_url=None, api_key=None):
    url = database_url or os.getenv("DATABASE_URL", "sqlite:///./cloudpulse.db")

    @asynccontextmanager
    async def lifespan(app):
        options = {"check_same_thread": False} if url.startswith("sqlite") else {}
        engine = create_engine(url, connect_args=options, pool_pre_ping=True)
        Base.metadata.create_all(engine)
        app.state.engine = engine
        try:
            yield
        finally:
            engine.dispose()

    app = FastAPI(title="CloudPulse", version="1.0.0", lifespan=lifespan)
    app.state.api_key = os.getenv("API_KEY", "") if api_key is None else api_key
    static = Path(__file__).parent / "static"
    app.mount("/static", StaticFiles(directory=static), name="static")

    @app.get("/", include_in_schema=False)
    def dashboard():
        return FileResponse(static / "index.html")

    @app.get("/api/health")
    def health(session: Session = Depends(database)):
        session.execute(text("SELECT 1"))
        return {"status": "ok", "database": "connected"}

    @app.post("/api/metrics", response_model=MetricView, status_code=201,
              dependencies=[Depends(require_key)])
    def add_metric(reading: Reading, session: Session = Depends(database)):
        history = session.scalars(
            select(Metric).where(Metric.server == reading.server)
            .order_by(Metric.id.desc()).limit(200)
        ).all()
        anomaly, reason = find_anomaly(reading, history)
        metric = Metric(**reading.model_dump(), created_at=datetime.now(timezone.utc),
                        anomaly=anomaly, reason=reason)
        session.add(metric)
        session.commit()
        session.refresh(metric)
        return metric

    @app.get("/api/metrics", response_model=list[MetricView])
    def metrics(server: str | None = None, limit: int = Query(120, ge=1, le=500),
                session: Session = Depends(database)):
        query = select(Metric)
        if server:
            query = query.where(Metric.server == server)
        rows = session.scalars(query.order_by(Metric.id.desc()).limit(limit)).all()
        return list(reversed(rows))

    @app.get("/api/servers", response_model=list[str])
    def servers(session: Session = Depends(database)):
        return session.scalars(select(Metric.server).distinct().order_by(Metric.server)).all()

    @app.get("/api/alerts", response_model=list[MetricView])
    def alerts(server: str | None = None, limit: int = Query(20, ge=1, le=100),
               session: Session = Depends(database)):
        query = select(Metric).where(Metric.anomaly.is_(True))
        if server:
            query = query.where(Metric.server == server)
        return session.scalars(query.order_by(Metric.id.desc()).limit(limit)).all()

    return app


app = create_app()
