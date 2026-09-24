from __future__ import annotations

from contextlib import asynccontextmanager
from uuid import uuid4

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from sqlalchemy import select
from starlette.exceptions import HTTPException as StarletteHTTPException

from .api.routes import router
from .config import Settings
from .db import Database
from .errors import ApiError
from .models import Map
from .monitoring.scheduler import CheckFunction, MonitorScheduler
from .schemas import HealthzOut
from .time import utc_iso


def _error_body(code: str, message: str, details=None) -> dict:
    error = {"code": code, "message": message}
    if details is not None:
        error["details"] = details
    return {"error": error}


def create_app(
    database_url: str | None = None,
    auto_migrate: bool | None = None,
    *,
    start_monitor_scheduler: bool = True,
    monitor_checker: CheckFunction | None = None,
) -> FastAPI:
    settings = Settings.from_env()
    if database_url is not None:
        settings = Settings(
            database_url=database_url,
            auto_migrate=settings.auto_migrate,
            monitor_concurrency=settings.monitor_concurrency,
        )
    if auto_migrate is not None:
        settings = Settings(
            database_url=settings.database_url,
            auto_migrate=auto_migrate,
            monitor_concurrency=settings.monitor_concurrency,
        )
    database = Database(settings.database_url)
    process_started_at = database.process_started_at
    scheduler = MonitorScheduler(
        database,
        concurrency=settings.monitor_concurrency,
        checker=monitor_checker,
    )

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        if settings.auto_migrate:
            database.migrate()
        with database.session() as session:
            if session.scalar(select(Map).limit(1)) is None:
                session.add(
                    Map(
                        id=str(uuid4()),
                        name="Home",
                        viewport_x=0.0,
                        viewport_y=0.0,
                        viewport_zoom=1.0,
                        created_at=utc_iso(process_started_at),
                        updated_at=utc_iso(process_started_at),
                    )
                )
                session.commit()
        if start_monitor_scheduler:
            await scheduler.start()
        try:
            yield
        finally:
            if start_monitor_scheduler:
                await scheduler.stop()
            database.dispose()

    app = FastAPI(title="Network Topology API", version="0.1.0", lifespan=lifespan)
    app.state.db = database
    app.state.process_started_at = process_started_at
    app.state.scheduler = scheduler if start_monitor_scheduler else None
    app.include_router(router)

    @app.get("/api/v1/healthz", response_model=HealthzOut)
    def healthz() -> dict[str, str]:
        return {"status": "ok"}

    @app.exception_handler(ApiError)
    async def api_error_handler(_request: Request, exc: ApiError) -> JSONResponse:
        return JSONResponse(
            status_code=exc.status_code, content=_error_body(exc.code, exc.message, exc.details)
        )

    @app.exception_handler(RequestValidationError)
    async def validation_error_handler(
        _request: Request, exc: RequestValidationError
    ) -> JSONResponse:
        details = [
            {"loc": list(error.get("loc", [])), "message": error.get("msg", "Invalid value")}
            for error in exc.errors()
        ]
        return JSONResponse(
            status_code=422,
            content=_error_body("validation_error", "Request validation failed", details),
        )

    @app.exception_handler(StarletteHTTPException)
    async def http_error_handler(_request: Request, exc: StarletteHTTPException) -> JSONResponse:
        code = "not_found" if exc.status_code == 404 else "http_error"
        return JSONResponse(status_code=exc.status_code, content=_error_body(code, str(exc.detail)))

    return app


app = create_app()
