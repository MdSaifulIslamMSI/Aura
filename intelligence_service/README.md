# Intelligence Service

This service hosts the Gemma 4 central intelligence layer for Aura Marketplace.

## Responsibilities

- accept normalized assistant requests from the Node backend
- call read-only Node tools instead of guessing
- compose app-grounded, runtime-grounded, or model-knowledge answers
- expose health for the reasoning service and active index state
- use `huggingface_hub.InferenceClient` for Gemma chat completion calls

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

## Hugging Face configuration

For Hugging Face-hosted Gemma inference, set:

- `INTELLIGENCE_ENDPOINT_API_KEY`
- `INTELLIGENCE_REASONING_MODEL`
- `INTELLIGENCE_ROUTING_MODEL`

Optional:

- `INTELLIGENCE_REASONING_ENDPOINT_URL`
- `INTELLIGENCE_ROUTING_ENDPOINT_URL`

If endpoint URLs are omitted, the service can still call `InferenceClient` directly against the configured model IDs.

Recommended defaults for this repo:

- `INTELLIGENCE_REASONING_MODEL=google/gemma-4-31B-it:novita`
- `INTELLIGENCE_ROUTING_MODEL=google/gemma-4-31B-it:novita`

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
