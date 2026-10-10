# AtlasGuard N-ATLaS inference service

A small FastAPI service that serves the **official `NCAIR1/N-ATLaS` weights** with Hugging
Face Transformers, following the model card's recipe (official tokenizer and chat template
with `date_string`, float16, `device_map="auto"`, prompt tokenised with
`add_special_tokens=False`, repetition penalty and temperature from the request). It does
inference only; AtlasGuard's API handles users, evaluation and storage.

| Endpoint | Auth | Purpose |
|---|---|---|
| `GET /health` | public | `{status, model_loaded, model_id, error}` — loading happens in the background |
| `GET /v1/models` | bearer | OpenAI-style model list (`NCAIR1/N-ATLaS`) |
| `GET /model-info` | bearer | revision (commit hash of the loaded weights), dtype, quantization, device, runtime, context length |
| `POST /v1/chat/completions` | bearer | non-streaming completion; adds `atlasguard.{inference_ms, revision, dtype, quantization, device, runtime, chat_template_date}` |

## Run

* **Free GPU (Kaggle/Colab):** use [`notebooks/natlas_inference_gpu.ipynb`](notebooks/natlas_inference_gpu.ipynb).
  It embeds this service verbatim (regenerate with `python scripts/build_notebook.py`).
* **Any CUDA machine:**

  ```bash
  pip install -r requirements.txt            # plus the CUDA build of torch for your host
  export HF_TOKEN=hf_... INFERENCE_API_KEY=$(openssl rand -hex 32)
  export NATLAS_REVISION=e294476928aca9030e924ca27bb8e085e8581273
  uvicorn app.main:app_factory --factory --host 0.0.0.0 --port 8000
  ```
* **Docker:** see the `Dockerfile` header (needs the NVIDIA container toolkit).

| Variable | Default | |
|---|---|---|
| `HF_TOKEN` | — | token of an account that accepted the N-ATLaS terms |
| `INFERENCE_API_KEY` | — | required bearer token (give AtlasGuard the same value as `NATLAS_API_KEY`) |
| `NATLAS_MODEL_ID` / `NATLAS_REVISION` | `NCAIR1/N-ATLaS` / default branch | weights to load (pin the revision) |
| `SERVED_MODEL_NAME` | `NCAIR1/N-ATLaS` | name reported in responses (must match AtlasGuard's `NATLAS_MODEL_ID`) |
| `TORCH_DTYPE` / `QUANTIZATION` | `float16` / `none` | `bfloat16`/`float32`; `8bit`/`4bit` need bitsandbytes |
| `CHAT_TEMPLATE_DATE` | today | fixed `date_string` for reproducible prompts |
| `MAX_CONCURRENT_GENERATIONS` / `MAX_NEW_TOKENS_LIMIT` / `MAX_INPUT_CHARS` | 1 / 2048 / 16000 | limits |
| `ALLOW_UNAUTHENTICATED` | false | local experiments only |

## Tests

```bash
python -m venv .venv && .venv/Scripts/pip install -r requirements-dev.txt   # (bin/ on Linux/macOS)
.venv/Scripts/pytest tests/test_api.py                                      # HTTP contract, fake backend
RUN_TINY_MODEL_TEST=1 pytest tests/test_transformers_backend.py            # real Transformers path on a tiny public Llama (CPU)
```

The tiny-model test checks loading, chat-template rendering with `date_string`, generation
parameters, decoding of new tokens only, deterministic greedy output and that the commit hash
of the loaded weights is recorded. It does not use N-ATLaS weights.

*N-ATLaS is an initiative of the Federal Ministry of Communications, Innovation and Digital
Economy, and powered by Awarri Technologies.* The weights are subject to the N-ATLaS licence
and are not included here.
