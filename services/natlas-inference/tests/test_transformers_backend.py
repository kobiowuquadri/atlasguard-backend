"""
Exercises the REAL TransformersBackend code path on CPU with a tiny public random Llama
model (not N-ATLaS). It verifies loading, chat-template rendering with `date_string`,
generation kwargs and decoding of only the new tokens. Opt-in because it downloads torch
and a small model:

    RUN_TINY_MODEL_TEST=1 pytest tests/test_transformers_backend.py
"""

from __future__ import annotations

import os

import pytest

pytestmark = pytest.mark.skipif(os.environ.get("RUN_TINY_MODEL_TEST") != "1", reason="set RUN_TINY_MODEL_TEST=1")

# Llama-3.1-style template that, like N-ATLaS's, consumes `date_string`.
TEMPLATE = (
    "{{ bos_token }}{{ '<|start_header_id|>system<|end_header_id|>\n\nToday Date: ' + date_string + '<|eot_id|>' }}"
    "{% for m in messages %}{{ '<|start_header_id|>' + m['role'] + '<|end_header_id|>\n\n' + m['content'] + '<|eot_id|>' }}{% endfor %}"
    "{% if add_generation_prompt %}{{ '<|start_header_id|>assistant<|end_header_id|>\n\n' }}{% endif %}"
)


def test_tiny_llama_end_to_end() -> None:
    from app.backend import TransformersBackend
    from app.config import Settings
    from app.schemas import ChatMessage

    settings = Settings(
        model_id="hf-internal-testing/tiny-random-LlamaForCausalLM",
        served_model_name="tiny-test",
        api_key="x",
        torch_dtype="float32",
        chat_template_date="09 Oct 2026",
    )
    backend = TransformersBackend(settings)
    backend.load()
    backend._tokenizer.chat_template = TEMPLATE  # the tiny test tokenizer ships without one

    result = backend.generate(
        [ChatMessage(role="system", content="You are helpful."), ChatMessage(role="user", content="Hello")],
        temperature=0.0,
        max_tokens=8,
        top_p=None,
        repetition_penalty=1.12,
        seed=1,
    )
    assert result.prompt_tokens > 0
    assert 0 < result.completion_tokens <= 8
    assert result.finish_reason in {"stop", "length"}
    assert result.chat_template_date == "09 Oct 2026"
    info = backend.info()
    assert info["revision"], "commit hash of the loaded weights should be recorded"
    assert info["device"] == "cpu"
    assert info["dtype"] == "float32"

    # Greedy decoding is deterministic.
    again = backend.generate(
        [ChatMessage(role="system", content="You are helpful."), ChatMessage(role="user", content="Hello")],
        temperature=0.0,
        max_tokens=8,
        top_p=None,
        repetition_penalty=1.12,
        seed=1,
    )
    assert again.text == result.text
