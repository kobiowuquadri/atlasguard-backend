# N-ATLaS integration

AtlasGuard evaluates the official **`NCAIR1/N-ATLaS`** model
(<https://huggingface.co/NCAIR1/N-ATLaS>): a multilingual Llama-3 8B fine-tune for English,
Hausa, Igbo and Yoruba, distributed as BF16 safetensors (four shards, ≈ 16 GB).

> N-ATLaS is an initiative of the Federal Ministry of Communications, Innovation and Digital
> Economy, and powered by Awarri Technologies.

## 1. Facts that shaped the design (checked 9 October 2026)

| Question | Finding |
|---|---|
| Access | Gated repository; approval is automatic after accepting the terms on Hugging Face (`gated: "auto"`). Downloads need a Hugging Face token of an account that accepted the terms. |
| Hosted inference | **None.** The model page states it is not deployed by any Inference Provider, and the challenge only issues N-ATLaS API credentials to shortlisted teams. |
| Weights | `LlamaForCausalLM`, 8.03 B parameters, BF16; revision `e294476928aca9030e924ca27bb8e085e8581273`. |
| Official inference recipe | `AutoTokenizer` + `AutoModelForCausalLM`, `torch_dtype=float16`, `device_map="auto"`, `tokenizer.apply_chat_template(messages, add_generation_prompt=True, tokenize=False, date_string=<today>)`, tokenise with `add_special_tokens=False`, `generate(max_new_tokens=…, repetition_penalty=1.12, temperature=0.1)`, recommended system prompt "you are a large language model trained by Awarri AI technologies…". |
| Hardware | ≈ 16 GB of GPU memory for float16 (e.g. 2 × T4, L4 24 GB, A10G, A100). A single 15 GB T4 needs 8-bit quantization. |
| Licence | N-ATLaS licence: research and innovation use, a cap of 1,000 active end users without a commercial licence, attribution required, prohibited uses listed on the model card. AtlasGuard never redistributes the weights. |

Because no hosted endpoint exists, AtlasGuard **self-hosts** the official weights (option B
of the project brief) with a small inference service, and keeps development fixtures (option
C) strictly separated and labelled.

## 2. Architecture

```mermaid
flowchart LR
  subgraph AtlasGuard API (NestJS)
    W[Evaluation worker] --> P[NatlasProvider]
  end
  P -- "HTTPS + Bearer token\nPOST /v1/chat/completions" --> S
  subgraph GPU host
    S[AtlasGuard inference service\nFastAPI + Transformers] --> M[(NCAIR1/N-ATLaS\nofficial weights)]
  end
```

* **`services/natlas-inference`** — Python, inference only. Loads the official weights with
  the recipe above and exposes an OpenAI-style subset: `GET /health` (public),
  `GET /v1/models`, `GET /model-info` and `POST /v1/chat/completions` (bearer token). Every
  completion reports the served model, token usage and an `atlasguard` block with
  generation time, revision, dtype, quantization, device, runtime and the chat-template date.
* **`NatlasProvider`** (`packages/evaluator/src/providers`) — server-side adapter used by the
  worker: timeouts, error classification (`PROVIDER_TIMEOUT`, `…_UNAVAILABLE`,
  `…_AUTH_FAILED`, `…_RATE_LIMITED`, `…_BAD_REQUEST`, `…_INVALID_RESPONSE`,
  `…_MODEL_MISMATCH`), limited retries for transient failures only (network, timeout, 429,
  5xx — never 4xx or malformed output), a concurrency limit, request ids, redirect refusal
  and validation that the endpoint reports **`NCAIR1/N-ATLaS`**. Any other model name is
  rejected and recorded as an error; AtlasGuard never falls back to another model.
* The endpoint URL and key are **server-side configuration only** (`NATLAS_BASE_URL`,
  `NATLAS_API_KEY`); users cannot point AtlasGuard at arbitrary URLs, which rules out SSRF
  through model settings. Credentials are never logged, stored with runs or exported.

## 3. Run N-ATLaS on a free GPU (Kaggle — recommended for the challenge)

1. **Accept the model terms.** Sign in to Hugging Face, open the model page, click **Agree
   and access repository**, then create a *read* token at
   <https://huggingface.co/settings/tokens>.
2. **Create a Kaggle notebook** from
   [`services/natlas-inference/notebooks/natlas_inference_gpu.ipynb`](../services/natlas-inference/notebooks/natlas_inference_gpu.ipynb)
   (*File → Import notebook*).
   * *Settings → Accelerator → **GPU T4 ×2*** (float16 weights split across both GPUs).
   * *Settings → Internet → **On*** (Kaggle requires a verified phone number).
   * *Add-ons → Secrets* → add **`HF_TOKEN`** with your Hugging Face token.
3. **Run all cells.** The notebook writes the service (embedded verbatim from `app/`),
   installs dependencies, downloads the pinned revision (first run ≈ 16 GB, several
   minutes), checks provenance, runs a Yoruba test prompt and opens a Cloudflare quick
   tunnel. The last cell prints:

   ```
   NATLAS_BASE_URL=https://<random>.trycloudflare.com
   NATLAS_API_KEY=<generated secret>
   ```
4. **Configure the AtlasGuard API** with those two values (in `apps/api/.env` locally, or in
   your host's environment settings) and restart it.
5. **Verify** (section 5).

Colab works the same way (*Runtime → T4 GPU*, secret `HF_TOKEN`), but a single 15 GB T4 needs
8-bit quantization; the notebook switches automatically and every response records
`quantization: "8bit"` so results stay honest about what was evaluated.

Limits of this option: Kaggle/Colab sessions end after inactivity or ~12 hours and quick
tunnels change URL on every start (update `NATLAS_BASE_URL` each time). Quick tunnels also
drop requests longer than ~100 s, so keep **max tokens ≤ 512** (the default).

## 4. Stable hosting (any CUDA machine)

```bash
docker build -t atlasguard-natlas-inference services/natlas-inference
docker run --gpus all -p 8000:8000 \
  -e HF_TOKEN=hf_... -e INFERENCE_API_KEY=$(openssl rand -hex 32) \
  -e NATLAS_REVISION=e294476928aca9030e924ca27bb8e085e8581273 \
  -v natlas-cache:/models atlasguard-natlas-inference
```

Put it behind HTTPS (a reverse proxy or the provider's HTTPS endpoint) and set
`NATLAS_BASE_URL`/`NATLAS_API_KEY` on the API. Environment options: `QUANTIZATION`
(`none`|`8bit`|`4bit`), `TORCH_DTYPE` (`float16`|`bfloat16`|`float32`), `CHAT_TEMPLATE_DATE`
(pin the date string for reproducibility), `MAX_CONCURRENT_GENERATIONS` (default 1),
`MAX_NEW_TOKENS_LIMIT`. *The Docker image has not been built on the development machine
(no Docker or GPU there); the same service code is exercised by the notebook and by the
service's tests.*

**vLLM alternative.** Any OpenAI-compatible server that serves the official weights works,
e.g. `vllm serve NCAIR1/N-ATLaS --dtype half --served-model-name NCAIR1/N-ATLaS`. vLLM has no
`/model-info`, so the revision is not reported automatically — set
`NATLAS_MODEL_REVISION` on the API to the commit you served. If you choose another
served-model name, list it in `NATLAS_ACCEPTED_MODEL_NAMES`.

## 5. Verifying the integration

1. **Model status.** `GET /api/v1/model/status` (or the status pill in the dashboard) must
   show `available`, served model `NCAIR1/N-ATLaS` and the revision.
2. **Smoke test** (real model, separate from the mocked unit tests):

   ```bash
   cd apps/api
   NATLAS_BASE_URL=https://… NATLAS_API_KEY=… pnpm smoke:natlas
   ```

   It checks health and provenance, then asks the capital of Nigeria in Nigerian English and
   Yoruba through the same `NatlasProvider` the worker uses, prints the responses, latency
   and verdicts, and exits non-zero on failure.
3. **Run an evaluation** with the *N-ATLaS* configuration (not *Development fixtures*). The
   run page shows the model, revision, runtime and every prompt/response pair.
4. **Export evidence** from the run page (*Export → N-ATLaS integration evidence*). The
   bundle contains the run provenance, every prompt, response, request id, served model,
   timing and token count, plus a SHA-256 digest over the canonical JSON. The API refuses
   this export for simulated runs and for unfinished runs. Store it under
   [`evidence/integration`](../evidence/README.md).

## 6. Development fixtures (simulated)

For local development and automated tests AtlasGuard ships hand-written fixture responses
(`packages/benchmarks/fixtures`) behind a separate *Development fixtures* configuration:

* off by default in production (`ENABLE_FIXTURE_PROVIDER` cannot be enabled when
  `NODE_ENV=production`);
* never selected automatically — choosing it requires an explicit confirmation;
* every fixture run is flagged `isSimulated`, labelled *Simulated* across the UI and exports,
  excluded from dashboard metrics unless explicitly included, and refused by the evidence
  export.

**A fixture-backed run is not evidence of N-ATLaS integration.**

## 7. Licence and attribution checklist

* Display the attribution sentence above wherever N-ATLaS results are shown (the dashboard
  footer, reports and exports already do).
* Do not redistribute the weights; each operator downloads them under their own accepted
  terms.
* Stay within the 1,000 active end-user cap unless a commercial licence is obtained.
* AtlasGuard's own source code is MIT-licensed; that licence does not extend to N-ATLaS.
