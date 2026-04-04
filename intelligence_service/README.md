# Intelligence Service

This service hosts the Gemma 4 central intelligence layer for Aura Marketplace.

## Responsibilities

- accept normalized assistant requests from the Node backend
- call read-only Node tools instead of guessing
- compose app-grounded, runtime-grounded, or model-knowledge answers
- expose health for the reasoning service and active index state
- use Google-hosted Gemma 4 through the native Gemini API by default, with Hugging Face-compatible endpoints only as an explicit fallback backend

## Local run

```bash
python -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8100
```

## Worker run

```bash
uvicorn app.worker:app --reload --port 8101
```

## Worker responsibilities

- load the generated repo bundle from `INTELLIGENCE_BUNDLE_SOURCE_PATH`
- embed code chunks with either a deterministic fallback, a Hugging Face feature-extraction model, or an OpenAI-compatible embeddings endpoint
- upsert chunk vectors into Qdrant
- sync the system graph into Neo4j
- publish `runtime/active_index.json` only after both stores validate successfully

## Primary Gemma Configuration

For the default Google-hosted Gemma 4 path, set:

- `GEMINI_API_KEY` or `GOOGLE_API_KEY`
- `INTELLIGENCE_GEMMA_PROVIDER_BACKEND=google_gemini`
- `INTELLIGENCE_REASONING_MODEL=gemma-4-31b-it`
- `INTELLIGENCE_ROUTING_MODEL=gemma-4-31b-it`

Optional:

- `GEMINI_API_BASE_URL`
- `INTELLIGENCE_GEMMA_THINKING_LEVEL=high`
- `INTELLIGENCE_GEMMA_INCLUDE_THOUGHTS=false`

If `INTELLIGENCE_GEMMA_PROVIDER_BACKEND=auto`, the service will still prefer the native Gemini API for Gemma models when a Gemini API key is present and no non-Google endpoint URL is forced.

## Hugging Face Fallback Configuration

Use this only when you intentionally want a Hugging Face-compatible backend instead of the default Google-hosted Gemma path.

Set:

- `INTELLIGENCE_GEMMA_PROVIDER_BACKEND=huggingface`
- `INTELLIGENCE_ENDPOINT_API_KEY`
- `INTELLIGENCE_REASONING_MODEL`
- `INTELLIGENCE_ROUTING_MODEL`

Optional:

- `INTELLIGENCE_REASONING_ENDPOINT_URL`
- `INTELLIGENCE_ROUTING_ENDPOINT_URL`

If endpoint URLs are omitted, the service can still call `InferenceClient` directly against the configured model IDs.

You can also provide `HF_TOKEN` or `HUGGINGFACEHUB_API_TOKEN` instead of `INTELLIGENCE_ENDPOINT_API_KEY`.

## Worker API

- `GET /health`
- `POST /v1/index/ingest`
- `POST /v1/index/publish`

`/v1/index/ingest` accepts:

```json
{
  "bundlePath": "",
  "publish": true,
  "recreateStores": false,
  "notes": ""
}
```

Set `recreateStores` to `true` when you need to rebuild the same bundle version into Qdrant from scratch.
