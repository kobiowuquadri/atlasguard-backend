"""Service configuration from environment variables."""

from __future__ import annotations

import os
from dataclasses import dataclass, field


def _bool(name: str, default: bool) -> bool:
    value = os.environ.get(name)
    if value is None or value == "":
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _int(name: str, default: int) -> int:
    value = os.environ.get(name)
    return int(value) if value else default


@dataclass(frozen=True)
class Settings:
    #: Hugging Face repository of the official weights.
    model_id: str = "NCAIR1/N-ATLaS"
    #: Commit to load. Pinning makes evaluations reproducible; empty means the default branch.
    revision: str | None = None
    #: Name reported in responses. Must match AtlasGuard's NATLAS_MODEL_ID.
    served_model_name: str = "NCAIR1/N-ATLaS"
    #: Hugging Face token of an account that accepted the N-ATLaS terms (gated repository).
    hf_token: str | None = None
    #: Bearer token AtlasGuard must send. Required unless allow_unauthenticated is true.
    api_key: str | None = None
    allow_unauthenticated: bool = False
    #: none | 8bit | 4bit (bitsandbytes).
    quantization: str = "none"
    #: float16 (model card default) | bfloat16 | float32.
    torch_dtype: str = "float16"
    #: Fixed date for the chat template ("09 Oct 2026"); empty uses today, like the model card.
    chat_template_date: str | None = None
    max_concurrent_generations: int = 1
    max_new_tokens_limit: int = 2048
    max_input_chars: int = 16000
    load_on_startup: bool = True
    cors_origins: list[str] = field(default_factory=list)

    @classmethod
    def from_env(cls) -> "Settings":
        return cls(
            model_id=os.environ.get("NATLAS_MODEL_ID", "NCAIR1/N-ATLaS"),
            revision=os.environ.get("NATLAS_REVISION") or None,
            served_model_name=os.environ.get("SERVED_MODEL_NAME", "NCAIR1/N-ATLaS"),
            hf_token=os.environ.get("HF_TOKEN") or os.environ.get("HUGGING_FACE_HUB_TOKEN") or None,
            api_key=os.environ.get("INFERENCE_API_KEY") or None,
            allow_unauthenticated=_bool("ALLOW_UNAUTHENTICATED", False),
            quantization=os.environ.get("QUANTIZATION", "none").lower(),
            torch_dtype=os.environ.get("TORCH_DTYPE", "float16").lower(),
            chat_template_date=os.environ.get("CHAT_TEMPLATE_DATE") or None,
            max_concurrent_generations=_int("MAX_CONCURRENT_GENERATIONS", 1),
            max_new_tokens_limit=_int("MAX_NEW_TOKENS_LIMIT", 2048),
            max_input_chars=_int("MAX_INPUT_CHARS", 16000),
            load_on_startup=_bool("LOAD_ON_STARTUP", True),
        )

    def validate(self) -> None:
        if not self.api_key and not self.allow_unauthenticated:
            raise RuntimeError(
                "INFERENCE_API_KEY is not set. Set it (and give the same value to AtlasGuard as NATLAS_API_KEY), "
                "or set ALLOW_UNAUTHENTICATED=true for strictly local testing."
            )
        if self.quantization not in {"none", "8bit", "4bit"}:
            raise RuntimeError("QUANTIZATION must be one of: none, 8bit, 4bit")
        if self.torch_dtype not in {"float16", "bfloat16", "float32"}:
            raise RuntimeError("TORCH_DTYPE must be one of: float16, bfloat16, float32")
