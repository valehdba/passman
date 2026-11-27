# syntax=docker/dockerfile:1
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# Install runtime deps only (no dev extras); non-editable.
COPY server/pyproject.toml ./pyproject.toml
COPY server/src ./src
RUN pip install .

COPY server/alembic.ini ./alembic.ini
COPY server/alembic ./alembic

RUN useradd --system --uid 10001 passman
USER passman

EXPOSE 8000
HEALTHCHECK --interval=15s --timeout=3s --retries=5 \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/healthz').status==200 else 1)"

# Apply migrations, then serve.
CMD ["sh", "-c", "alembic upgrade head && exec uvicorn passman.main:app --host 0.0.0.0 --port 8000"]
