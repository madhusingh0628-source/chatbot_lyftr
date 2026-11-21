# ---------- stage 1: build dependencies ----------
FROM python:3.12-slim AS builder
ENV PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1
RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"
COPY requirements.txt .
RUN pip install -r requirements.txt
# LiteLLM counts tokens with tiktoken, which downloads tokenizer files on first use.
# Seed the cache with the files LiteLLM ships, then fetch any others now, so the
# running container never needs that network call.
ENV TIKTOKEN_CACHE_DIR=/opt/tiktoken
RUN mkdir -p /opt/tiktoken \
 && python -c "import litellm, os, shutil; d=os.path.join(os.path.dirname(litellm.__file__),'litellm_core_utils','tokenizers'); [shutil.copy(os.path.join(d,f),'/opt/tiktoken') for f in os.listdir(d) if len(f)==40]" \
 && (python -c "import tiktoken; [tiktoken.get_encoding(e) for e in ('cl100k_base','o200k_base','p50k_base','r50k_base')]" \
     || echo "WARNING: could not download extra tokenizers; using the ones bundled with LiteLLM")

# ---------- stage 2: small runtime image ----------
FROM python:3.12-slim
ENV PATH="/opt/venv/bin:$PATH" \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    CUSTOM_TIKTOKEN_CACHE_DIR=/opt/tiktoken \
    DATABASE_URL=sqlite:////data/app.db
RUN useradd --create-home --uid 1000 app && mkdir -p /data && chown app:app /data
COPY --from=builder /opt/venv /opt/venv
COPY --from=builder /opt/tiktoken /opt/tiktoken
WORKDIR /app
COPY app ./app
USER app
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD python -c "import os,urllib.request; urllib.request.urlopen(f'http://localhost:{os.getenv(\"PORT\",\"8000\")}/health')"
# ONE worker on purpose: the LiteLLM cache lives in this process's memory.
# $PORT lets hosts like Render choose the port; defaults to 8000 locally.
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000} --workers 1"]
