"""HTTP-layer tests with a FAKE backend (no model weights are loaded here)."""

from __future__ import annotations

from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from app.schemas import ChatMessage, GenerationResult

API_KEY = "test-inference-key"


class FakeBackend:
    def __init__(self, loaded: bool = True, fail: bool = False) -> None:
        self._loaded = loaded
        self.fail = fail
        self.calls: list[dict[str, Any]] = []

    def load(self) -> None:
        self._loaded = True

    @property
    def loaded(self) -> bool:
        return self._loaded

    @property
    def load_error(self) -> str | None:
        return None

    def info(self) -> dict[str, Any]:
        return {"model_id": "NCAIR1/N-ATLaS", "revision": "abc123", "dtype": "float16", "quantization": "none", "device": "fake", "runtime": "fake", "context_length": 8192}

    def generate(self, messages: list[ChatMessage], **kwargs: Any) -> GenerationResult:
        if self.fail:
            raise RuntimeError("CUDA out of memory")
        self.calls.append({"messages": messages, **kwargs})
        return GenerationResult(
            text="Abuja ni olú-ìlú Nàìjíríà.",
            prompt_tokens=21,
            completion_tokens=9,
            finish_reason="stop",
            inference_ms=1234,
            chat_template_date="09 Oct 2026",
        )


def client(backend: FakeBackend | None = None, **overrides: Any) -> tuple[TestClient, FakeBackend]:
    backend = backend or FakeBackend()
    settings = Settings(api_key=API_KEY, load_on_startup=False, **overrides)
    return TestClient(create_app(settings, backend)), backend


AUTH = {"Authorization": f"Bearer {API_KEY}"}
BODY = {"model": "NCAIR1/N-ATLaS", "messages": [{"role": "user", "content": "Kí ni olú-ìlú Nàìjíríà?"}], "temperature": 0.1, "max_tokens": 64, "repetition_penalty": 1.12}


def test_health_is_public_and_reports_loading_state() -> None:
    c, _ = client(FakeBackend(loaded=False))
    body = c.get("/health").json()
    assert body["model_loaded"] is False
    assert body["status"] == "loading"


def test_requires_bearer_token() -> None:
    c, _ = client()
    assert c.post("/v1/chat/completions", json=BODY).status_code == 401
    assert c.post("/v1/chat/completions", json=BODY, headers={"Authorization": "Bearer wrong"}).status_code == 401
    assert c.get("/model-info").status_code == 401


def test_chat_completion_shape_and_parameters() -> None:
    c, backend = client()
    res = c.post("/v1/chat/completions", json=BODY, headers={**AUTH, "x-request-id": "req-42"})
    assert res.status_code == 200
    data = res.json()
    assert data["model"] == "NCAIR1/N-ATLaS"
    assert data["choices"][0]["message"]["content"] == "Abuja ni olú-ìlú Nàìjíríà."
    assert data["choices"][0]["finish_reason"] == "stop"
    assert data["usage"] == {"prompt_tokens": 21, "completion_tokens": 9, "total_tokens": 30}
    assert data["atlasguard"]["inference_ms"] == 1234
    assert data["atlasguard"]["revision"] == "abc123"
    assert data["atlasguard"]["request_id"] == "req-42"
    assert res.headers["x-request-id"] == "req-42"
    call = backend.calls[0]
    assert call["temperature"] == 0.1 and call["max_tokens"] == 64 and call["repetition_penalty"] == 1.12


def test_rejects_other_models_and_streaming() -> None:
    c, _ = client()
    assert c.post("/v1/chat/completions", json={**BODY, "model": "gpt-4o"}, headers=AUTH).status_code == 404
    assert c.post("/v1/chat/completions", json={**BODY, "stream": True}, headers=AUTH).status_code == 400


def test_returns_503_while_loading() -> None:
    c, _ = client(FakeBackend(loaded=False))
    assert c.post("/v1/chat/completions", json=BODY, headers=AUTH).status_code == 503


def test_validates_limits() -> None:
    c, _ = client(max_new_tokens_limit=128)
    assert c.post("/v1/chat/completions", json={**BODY, "max_tokens": 1024}, headers=AUTH).status_code == 422
    assert c.post("/v1/chat/completions", json={**BODY, "messages": []}, headers=AUTH).status_code == 422
    assert c.post("/v1/chat/completions", json={**BODY, "temperature": 5}, headers=AUTH).status_code == 422


def test_generation_failure_is_a_500_without_internal_details() -> None:
    c, _ = client(FakeBackend(fail=True))
    res = c.post("/v1/chat/completions", json=BODY, headers=AUTH)
    assert res.status_code == 500
    assert "CUDA" not in res.text


def test_models_and_model_info() -> None:
    c, _ = client()
    assert c.get("/v1/models", headers=AUTH).json()["data"][0]["id"] == "NCAIR1/N-ATLaS"
    info = c.get("/model-info", headers=AUTH).json()
    assert info["revision"] == "abc123" and info["loaded"] is True


def test_refuses_to_start_without_api_key() -> None:
    with pytest.raises(RuntimeError, match="INFERENCE_API_KEY"):
        create_app(Settings(api_key=None, load_on_startup=False), FakeBackend())
