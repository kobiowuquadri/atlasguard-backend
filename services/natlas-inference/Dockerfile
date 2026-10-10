# GPU image for the AtlasGuard N-ATLaS inference service.
# Build:  docker build -t atlasguard-natlas-inference services/natlas-inference
# Run:    docker run --gpus all -p 8000:8000 -e HF_TOKEN=... -e INFERENCE_API_KEY=... \
#           -v natlas-cache:/models atlasguard-natlas-inference
FROM pytorch/pytorch:2.5.1-cuda12.4-cudnn9-runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    HF_HOME=/models \
    PORT=8000

WORKDIR /srv
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app
RUN useradd --create-home --uid 10001 natlas && mkdir -p /models && chown natlas:natlas /models
USER natlas

EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=600s CMD python -c "import urllib.request,sys; sys.exit(0 if b'\"model_loaded\":true' in urllib.request.urlopen('http://127.0.0.1:8000/health').read().replace(b' ', b'') else 1)"
CMD ["sh", "-c", "uvicorn app.main:app_factory --factory --host 0.0.0.0 --port ${PORT}"]
