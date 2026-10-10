"""Model backends. `TransformersBackend` runs the official N-ATLaS weights; tests use a fake."""

from __future__ import annotations

import threading
import time
from datetime import datetime, timezone
from typing import Any, Protocol

from .config import Settings
from .schemas import ChatMessage, GenerationResult


class Backend(Protocol):
    """What the HTTP layer needs from a model runtime."""

    def load(self) -> None: ...

    @property
    def loaded(self) -> bool: ...

    @property
    def load_error(self) -> str | None: ...

    def info(self) -> dict[str, Any]: ...

    def generate(
        self,
        messages: list[ChatMessage],
        *,
        temperature: float,
        max_tokens: int,
        top_p: float | None,
        repetition_penalty: float | None,
        seed: int | None,
    ) -> GenerationResult: ...


class TransformersBackend:
    """
    Loads NCAIR1/N-ATLaS with Hugging Face Transformers following the official model card:
    official tokenizer and chat template (with `date_string`), float16 weights by default,
    `device_map="auto"`, and prompt tokenisation with `add_special_tokens=False`.
    """

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self._model: Any = None
        self._tokenizer: Any = None
        self._loaded = False
        self._load_error: str | None = None
        self._resolved_revision: str | None = settings.revision
        self._device: str | None = None
        self._runtime: str | None = None
        self._lock = threading.Lock()

    @property
    def loaded(self) -> bool:
        return self._loaded

    @property
    def load_error(self) -> str | None:
        return self._load_error

    def load(self) -> None:
        try:
            import torch
            import transformers
            from transformers import AutoModelForCausalLM, AutoTokenizer

            kwargs: dict[str, Any] = {"revision": self.settings.revision, "token": self.settings.hf_token}
            tokenizer = AutoTokenizer.from_pretrained(self.settings.model_id, **kwargs)
            dtype = getattr(torch, self.settings.torch_dtype)
            model_kwargs: dict[str, Any] = {**kwargs, "device_map": "auto", "torch_dtype": dtype}
            if self.settings.quantization in {"8bit", "4bit"}:
                from transformers import BitsAndBytesConfig

                model_kwargs["quantization_config"] = (
                    BitsAndBytesConfig(load_in_8bit=True)
                    if self.settings.quantization == "8bit"
                    else BitsAndBytesConfig(load_in_4bit=True, bnb_4bit_compute_dtype=dtype)
                )
            model = AutoModelForCausalLM.from_pretrained(self.settings.model_id, **model_kwargs)
            model.eval()

            self._resolved_revision = getattr(model.config, "_commit_hash", None) or self.settings.revision
            if torch.cuda.is_available():
                names = sorted({torch.cuda.get_device_name(i) for i in range(torch.cuda.device_count())})
                self._device = f"cuda x{torch.cuda.device_count()} ({', '.join(names)})"
            else:
                self._device = "cpu"
            self._runtime = f"transformers {transformers.__version__}; torch {torch.__version__}"
            self._tokenizer = tokenizer
            self._model = model
            self._loaded = True
        except Exception as exc:  # noqa: BLE001 - surfaced through /health
            self._load_error = f"{type(exc).__name__}: {exc}"
            raise

    def info(self) -> dict[str, Any]:
        context_length = None
        if self._model is not None:
            context_length = getattr(self._model.config, "max_position_embeddings", None)
        return {
            "model_id": self.settings.served_model_name,
            "source_repository": self.settings.model_id,
            "revision": self._resolved_revision,
            "dtype": self.settings.torch_dtype,
            "quantization": self.settings.quantization,
            "device": self._device,
            "runtime": self._runtime,
            "context_length": context_length,
        }

    def _template_date(self) -> str:
        return self.settings.chat_template_date or datetime.now(timezone.utc).strftime("%d %b %Y")

    def generate(
        self,
        messages: list[ChatMessage],
        *,
        temperature: float,
        max_tokens: int,
        top_p: float | None,
        repetition_penalty: float | None,
        seed: int | None,
    ) -> GenerationResult:
        if not self._loaded:
            raise RuntimeError("model is not loaded")
        import torch

        date_string = self._template_date()
        prompt = self._tokenizer.apply_chat_template(
            [m.model_dump() for m in messages],
            add_generation_prompt=True,
            tokenize=False,
            date_string=date_string,
        )
        inputs = self._tokenizer(prompt, return_tensors="pt", add_special_tokens=False).to(self._model.device)
        prompt_tokens = int(inputs["input_ids"].shape[1])

        generate_kwargs: dict[str, Any] = {
            "max_new_tokens": max_tokens,
            "use_cache": True,
            "pad_token_id": self._tokenizer.eos_token_id,
        }
        if repetition_penalty is not None:
            generate_kwargs["repetition_penalty"] = repetition_penalty
        if temperature > 0:
            generate_kwargs.update(do_sample=True, temperature=temperature)
            if top_p is not None:
                generate_kwargs["top_p"] = top_p
        else:
            generate_kwargs["do_sample"] = False

        with self._lock:
            if seed is not None:
                torch.manual_seed(seed)
            started = time.perf_counter()
            with torch.inference_mode():
                output = self._model.generate(**inputs, **generate_kwargs)
            inference_ms = int((time.perf_counter() - started) * 1000)

        new_tokens = output[0][prompt_tokens:]
        completion_tokens = int(new_tokens.shape[0])
        text = self._tokenizer.decode(new_tokens, skip_special_tokens=True).strip()
        finish_reason = "length" if completion_tokens >= max_tokens else "stop"
        return GenerationResult(
            text=text,
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            finish_reason=finish_reason,
            inference_ms=inference_ms,
            chat_template_date=date_string,
        )
