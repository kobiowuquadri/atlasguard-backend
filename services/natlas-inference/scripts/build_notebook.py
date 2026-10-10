"""
Generates notebooks/natlas_inference_gpu.ipynb, a self-contained Kaggle/Colab notebook that
runs this service on a free GPU and exposes it to AtlasGuard through a Cloudflare tunnel.
The service source is embedded verbatim from app/, so the notebook never drifts from the
tested code. Re-run after changing app/:

    python scripts/build_notebook.py
"""

from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
APP_FILES = ["__init__.py", "config.py", "schemas.py", "backend.py", "main.py"]
PINNED_REVISION = "e294476928aca9030e924ca27bb8e085e8581273"


def md(text: str) -> dict:
    return {"cell_type": "markdown", "metadata": {}, "source": text.strip("\n").splitlines(keepends=True)}


def code(text: str) -> dict:
    return {
        "cell_type": "code",
        "execution_count": None,
        "metadata": {},
        "outputs": [],
        "source": text.strip("\n").splitlines(keepends=True),
    }


def main() -> None:
    files = {f"natlas-inference/app/{name}": (ROOT / "app" / name).read_text(encoding="utf-8") for name in APP_FILES}
    write_files = "import os\n\nFILES = " + json.dumps(files, ensure_ascii=False, indent=1) + """

for path, content in FILES.items():
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(content)
print("Wrote", len(FILES), "service files to", os.path.abspath("natlas-inference"))
"""

    cells = [
        md(
            f"""
# AtlasGuard — N-ATLaS inference endpoint on a free GPU

This notebook serves the **official `NCAIR1/N-ATLaS` weights** (revision `{PINNED_REVISION[:12]}…`) with the AtlasGuard
inference service and exposes it to your AtlasGuard API through a temporary Cloudflare tunnel.

**Before you run it**

1. On Hugging Face, open <https://huggingface.co/NCAIR1/N-ATLaS> and click **Agree and access repository** (approval is automatic).
   Create a *read* token at <https://huggingface.co/settings/tokens>.
2. **Kaggle (recommended):** *Settings → Accelerator → GPU T4 ×2*, *Internet → On* (requires a verified phone number),
   *Add-ons → Secrets →* add `HF_TOKEN`. Two T4s hold the float16 weights, as in the model card.
   **Colab:** *Runtime → Change runtime type → T4 GPU*, add `HF_TOKEN` under *Secrets* and grant notebook access.
   A single 15 GB T4 cannot hold float16 weights, so this notebook switches to 8-bit quantization there and records that in
   every response's provenance.
3. Run all cells. The last cell prints `NATLAS_BASE_URL` and `NATLAS_API_KEY` for your AtlasGuard API.

**Notes:** keep this tab open while evaluating — Kaggle/Colab sessions and quick tunnels are temporary. Use the Docker image on a
GPU VM for stable hosting. N-ATLaS is released under its own licence (1,000 active-user cap without a commercial licence);
review it before deploying.

*N-ATLaS is an initiative of the Federal Ministry of Communications, Innovation and Digital Economy, and powered by Awarri Technologies.*
"""
        ),
        md("## 1. Write the AtlasGuard inference service"),
        code(write_files),
        md("## 2. Install dependencies"),
        code(
            """
import subprocess, sys
subprocess.run([sys.executable, "-m", "pip", "install", "-q", "fastapi>=0.115", "uvicorn[standard]>=0.30",
                "transformers>=4.45,<5", "accelerate>=0.34", "huggingface_hub>=0.25"], check=True)
import torch
print("torch", torch.__version__, "| CUDA available:", torch.cuda.is_available())
for i in range(torch.cuda.device_count()):
    p = torch.cuda.get_device_properties(i)
    print(f"  GPU {i}: {p.name} — {p.total_memory / 1024**3:.1f} GB")
"""
        ),
        md("## 3. Configure (Hugging Face token, API key, precision)"),
        code(
            f"""
import os, secrets, torch

def read_secret(name):
    try:
        from kaggle_secrets import UserSecretsClient  # Kaggle
        return UserSecretsClient().get_secret(name)
    except Exception:
        pass
    try:
        from google.colab import userdata  # Colab
        return userdata.get(name)
    except Exception:
        pass
    return os.environ.get(name)

hf_token = read_secret("HF_TOKEN")
assert hf_token, "Add your Hugging Face read token as the secret HF_TOKEN (see the first cell)."

total_vram_gb = sum(torch.cuda.get_device_properties(i).total_memory for i in range(torch.cuda.device_count())) / 1024**3
quantization = "none" if total_vram_gb >= 20 else "8bit"
if quantization == "8bit":
    subprocess.run([sys.executable, "-m", "pip", "install", "-q", "bitsandbytes>=0.43"], check=True)

INFERENCE_API_KEY = secrets.token_urlsafe(32)
os.environ.update({{
    "HF_TOKEN": hf_token,
    "INFERENCE_API_KEY": INFERENCE_API_KEY,
    "NATLAS_MODEL_ID": "NCAIR1/N-ATLaS",
    "NATLAS_REVISION": "{PINNED_REVISION}",
    "SERVED_MODEL_NAME": "NCAIR1/N-ATLaS",
    "QUANTIZATION": quantization,
    "TORCH_DTYPE": "float16",
}})
print(f"Total GPU memory: {{total_vram_gb:.1f}} GB -> quantization = {{quantization}}")
"""
        ),
        md("## 4. Start the service and load N-ATLaS (first download ≈ 16 GB, several minutes)"),
        code(
            """
import subprocess, time, json, urllib.request

# Re-running this cell replaces a server left from an earlier attempt (it would still hold port 8000).
if "server" in globals() and server.poll() is None:
    server.terminate()
    server.wait(timeout=30)

log = open("natlas-inference/server.log", "w")
server = subprocess.Popen(
    [sys.executable, "-m", "uvicorn", "app.main:app_factory", "--factory", "--host", "127.0.0.1", "--port", "8000"],
    cwd="natlas-inference", stdout=log, stderr=subprocess.STDOUT,
)

def health():
    with urllib.request.urlopen("http://127.0.0.1:8000/health", timeout=5) as r:
        return json.load(r)

started = time.time()
while True:
    time.sleep(10)
    try:
        h = health()
    except Exception:
        h = {"status": "starting"}
    print(f"[{int(time.time() - started):>4}s] {h.get('status')}" + (f" — {h.get('error')}" if h.get("error") else ""))
    if h.get("model_loaded") or h.get("status") == "error" or server.poll() is not None:
        break
print(open("natlas-inference/server.log").read()[-2000:])
if not h.get("model_loaded"):
    raise RuntimeError(
        "N-ATLaS did not load - read the log above. '403 ... gated repo' means the Hugging Face account behind "
        "HF_TOKEN has not been granted access: open https://huggingface.co/NCAIR1/N-ATLaS while signed in to that "
        "account and accept the terms, then run this cell again."
    )
"""
        ),
        md("## 5. Check provenance and run a test generation"),
        code(
            """
def call(path, payload=None):
    req = urllib.request.Request("http://127.0.0.1:8000" + path,
        data=json.dumps(payload).encode() if payload is not None else None,
        headers={"Authorization": f"Bearer {INFERENCE_API_KEY}", "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=300) as r:
        return json.load(r)

print(json.dumps(call("/model-info"), indent=2))
reply = call("/v1/chat/completions", {
    "model": "NCAIR1/N-ATLaS",
    "messages": [{"role": "user", "content": "Kí ni olú-ìlú orílẹ̀-èdè Nàìjíríà?"}],
    "temperature": 0.1, "max_tokens": 128, "repetition_penalty": 1.12,
})
print(reply["choices"][0]["message"]["content"])
print(json.dumps(reply["usage"]), json.dumps(reply["atlasguard"]))
"""
        ),
        md("## 6. Expose the endpoint to AtlasGuard (Cloudflare quick tunnel)"),
        code(
            """
import re
subprocess.run("wget -q -O cloudflared https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 && chmod +x cloudflared",
               shell=True, check=True)
if "tunnel" in globals() and tunnel.poll() is None:
    tunnel.terminate()
tunnel_log = open("cloudflared.log", "w")
tunnel = subprocess.Popen(["./cloudflared", "tunnel", "--no-autoupdate", "--url", "http://127.0.0.1:8000"],
                          stdout=tunnel_log, stderr=subprocess.STDOUT)
url = None
for _ in range(60):
    time.sleep(2)
    m = re.search(r"https://[a-z0-9-]+\\.trycloudflare\\.com", open("cloudflared.log").read())
    if m:
        url = m.group(0)
        break
assert url, "Tunnel did not start; see cloudflared.log"
print("Add these to your AtlasGuard API environment (apps/api/.env or your host's settings):\\n")
print(f"NATLAS_BASE_URL={url}")
print(f"NATLAS_API_KEY={INFERENCE_API_KEY}")
print("\\nThen restart the API and open the dashboard: the model status should show N-ATLaS as available.")
"""
        ),
        md(
            """
## 7. Keep the session alive

Leave this notebook running while you evaluate. If the session restarts, run all cells again — you will get a **new**
tunnel URL and API key to update in AtlasGuard. Quick tunnels drop requests longer than ~100 s, so keep `maxTokens`
at 512 or below.
"""
        ),
    ]

    notebook = {
        "cells": cells,
        "metadata": {
            "kernelspec": {"display_name": "Python 3", "language": "python", "name": "python3"},
            "language_info": {"name": "python"},
            "accelerator": "GPU",
        },
        "nbformat": 4,
        "nbformat_minor": 5,
    }
    out = ROOT / "notebooks" / "natlas_inference_gpu.ipynb"
    out.parent.mkdir(exist_ok=True)
    out.write_text(json.dumps(notebook, ensure_ascii=False, indent=1) + "\n", encoding="utf-8", newline="\n")
    print(f"wrote {out.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
