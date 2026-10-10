"""Request/response models for the OpenAI-compatible subset AtlasGuard uses."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class ChatMessage(BaseModel):
    role: Literal["system", "user", "assistant"]
    content: str = Field(max_length=16000)


class ChatCompletionRequest(BaseModel):
    model: str | None = None
    messages: list[ChatMessage] = Field(min_length=1, max_length=32)
    temperature: float = Field(default=0.1, ge=0.0, le=2.0)
    max_tokens: int = Field(default=512, ge=1, le=4096)
    top_p: float | None = Field(default=None, gt=0.0, le=1.0)
    repetition_penalty: float | None = Field(default=None, ge=1.0, le=2.0)
    seed: int | None = Field(default=None, ge=0, le=2**31 - 1)
    stream: bool = False


class GenerationResult(BaseModel):
    text: str
    prompt_tokens: int
    completion_tokens: int
    finish_reason: Literal["stop", "length"]
    inference_ms: int
    chat_template_date: str
