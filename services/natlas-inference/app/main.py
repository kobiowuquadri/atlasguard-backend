"""
OpenAI-compatible HTTP API in front of the official N-ATLaS weights.

Endpoints
  GET  /health                public; reports whether the model is loaded
  GET  /v1/models             authenticated; the served model
  GET  /model-info            authenticated; revision, dtype, device, runtime (provenance)
  POST /v1/chat/completions   authenticated; non-streaming chat completion

This service performs inference only. Authentication of end users, evaluation logic and
persistence live in the AtlasGuard API, which calls this service with a bearer token.
"""

from __future__ import annotations

import asyncio
import logging
import secrets
import threading
import time
import uuid
from contextlib import asynccontextmanager
from typing import Any

from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool

from . import __version__
from .backend import Backend, TransformersBackend
from .config import Settings
from .schemas import ChatCompletionRequest

logger = logging.getLogger("natlas_inference")


def create_app(settings: Settings | None = None, backend: Backend | None = None) -> FastAPI:
    settings = settings or Settings.from_env()
    settings.validate()
    backend = backend or TransformersBackend(settings)
    semaphore = asyncio.Semaphore(settings.max_concurrent_generations)
    state: dict[str, Any] = {"started_at": time.time()}

    def load_in_background() -> None:
        try:
            logger.info("Loading %s (revision=%s)…", settings.model_id, settings.revision or "default branch")
            backend.load()
            logger.info("Model loaded: %s", backend.info())
        except Exception:  # noqa: BLE001
            logger.exception("Model failed to load")

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        if settings.load_on_startup and not backend.loaded:
            threading.Thread(target=load_in_background, name="model-loader", daemon=True).start()
        yield

    app = FastAPI(title="AtlasGuard N-ATLaS inference service", version=__version__, lifespan=lifespan, docs_url=None, redoc_url=None)

    def require_api_key(authorization: str | None = Header(default=None)) -> None:
        if settings.allow_unauthenticated:
            return
        expected = f"Bearer {settings.api_key}"
        if authorization is None or not secrets.compare_digest(authorization.encode(), expected.encode()):
            raise HTTPException(status_code=401, detail="invalid or missing bearer token")

    @app.middleware("http")
    async def request_id(request: Request, call_next):
        rid = request.headers.get("x-request-id") or str(uuid.uuid4())
        started = time.perf_counter()
        response = await call_next(request)
        response.headers["x-request-id"] = rid
        logger.info(
            "%s %s %s %dms rid=%s", request.method, request.url.path, response.status_code,
            int((time.perf_counter() - started) * 1000), rid,
        )
        return response

    @app.get("/health")
    def health() -> dict[str, Any]:
        return {
            "status": "ready" if backend.loaded else ("error" if backend.load_error else "loading"),
            "model_loaded": backend.loaded,
            "model_id": settings.served_model_name,
            "error": backend.load_error,
            "uptime_seconds": int(time.time() - state["started_at"]),
            "service_version": __version__,
        }

    @app.get("/v1/models", dependencies=[Depends(require_api_key)])
    def models() -> dict[str, Any]:
        return {
            "object": "list",
            "data": [{"id": settings.served_model_name, "object": "model", "owned_by": "NCAIR1 / Awarri"}],
        }

    @app.get("/model-info", dependencies=[Depends(require_api_key)])
    def model_info() -> dict[str, Any]:
        return {**backend.info(), "loaded": backend.loaded, "service_version": __version__}

    @app.post("/v1/chat/completions", dependencies=[Depends(require_api_key)])
    async def chat_completions(body: ChatCompletionRequest, request: Request) -> JSONResponse:
        if body.stream:
            raise HTTPException(status_code=400, detail="streaming is not supported")
        if body.model and body.model.lower() != settings.served_model_name.lower():
            raise HTTPException(status_code=404, detail=f"model '{body.model}' is not served here")
        if not backend.loaded:
            raise HTTPException(status_code=503, detail=backend.load_error or "model is still loading")
        if body.max_tokens > settings.max_new_tokens_limit:
            raise HTTPException(status_code=422, detail=f"max_tokens must be <= {settings.max_new_tokens_limit}")
        if sum(len(m.content) for m in body.messages) > settings.max_input_chars:
            raise HTTPException(status_code=413, detail="input is too long")

        async with semaphore:
            try:
                result = await run_in_threadpool(
                    backend.generate,
                    body.messages,
                    temperature=body.temperature,
                    max_tokens=body.max_tokens,
                    top_p=body.top_p,
                    repetition_penalty=body.repetition_penalty,
                    seed=body.seed,
                )
            except Exception as exc:  # noqa: BLE001
                logger.exception("generation failed")
                raise HTTPException(status_code=500, detail="generation failed") from exc

        info = backend.info()
        return JSONResponse(
            {
                "id": f"chatcmpl-{uuid.uuid4().hex}",
                "object": "chat.completion",
                "created": int(time.time()),
                "model": settings.served_model_name,
                "choices": [
                    {
                        "index": 0,
                        "message": {"role": "assistant", "content": result.text},
                        "finish_reason": result.finish_reason,
                    }
                ],
                "usage": {
                    "prompt_tokens": result.prompt_tokens,
                    "completion_tokens": result.completion_tokens,
                    "total_tokens": result.prompt_tokens + result.completion_tokens,
                },
                "atlasguard": {
                    "inference_ms": result.inference_ms,
                    "revision": info.get("revision"),
                    "dtype": info.get("dtype"),
                    "quantization": info.get("quantization"),
                    "device": info.get("device"),
                    "runtime": info.get("runtime"),
                    "chat_template_date": result.chat_template_date,
                    "request_id": request.headers.get("x-request-id"),
                },
            }
        )

    return app


def app_factory() -> FastAPI:
    """Entry point for `uvicorn app.main:app_factory --factory`."""
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    return create_app()
