FROM python:3.11-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV PIP_NO_CACHE_DIR=1
ENV PORT=8100
ENV INTELLIGENCE_BUNDLE_SOURCE_PATH=/app/server/generated/intelligence/current/bundle.json

WORKDIR /app

COPY intelligence_service/requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt

COPY intelligence_service /app/intelligence_service
COPY server/generated /app/server/generated

WORKDIR /app/intelligence_service

EXPOSE 8100

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8100"]
