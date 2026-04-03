# System-Aware Intelligence Layer

## What changed

The assistant stack now supports a second path behind `POST /api/ai/chat`:

- Node remains the public entrypoint and system-of-record boundary.
- A new Python intelligence service can answer repo-aware and runtime-aware questions.
- The Python service is required to call typed Node tools instead of guessing.
- The assistant UI can render verification badges, source chips, tool runs, and trace metadata.

## Request flow

1. `server/controllers/aiController.js` accepts the request.
2. `server/services/ai/assistantOrchestratorService.js` decides whether to keep the legacy commerce path or hand off to the central intelligence layer.
3. `server/services/intelligence/intelligenceGatewayService.js` checks bundle freshness and forwards the normalized request to the Python service.
4. The Python service calls back into `POST /api/internal/ai-tools/run` for read-only evidence.
5. The final answer returns with:
   - `assistantTurn.citations`
   - `assistantTurn.toolRuns`
   - `assistantTurn.verification`
   - `grounding.bundleVersion`
   - `grounding.traceId`

## Knowledge bundle

Because the production backend image is built from `server/` only, the repo-wide knowledge layer is generated ahead of image build:

- script: `server/scripts/build_code_intelligence_bundle.js`
- output: `server/generated/intelligence/current/bundle.json`

The bundle contains:

- code chunks from `app/`, `server/`, `docs/`, and `infra/`
- extracted Express route contracts
- extracted Mongoose model fields
- frontend API touchpoints
- a lightweight system graph

## Local development

- Node backend: `npm run runtime:split:up` from `server/`
- Python intelligence service: `uvicorn app.main:app --reload --port 8100`
- Python worker: `uvicorn app.worker:app --reload --port 8101`

The compose stack now starts both the intelligence service and the worker so the Node API can call them over the same contracts used in production.

## Worker ingestion

The Python worker now owns the retrieval-store publish flow:

1. Read `server/generated/intelligence/current/bundle.json`
2. Embed all code chunks
3. Upsert chunk payloads into a versioned Qdrant collection
4. Sync graph nodes and edges into Neo4j
5. Validate counts
6. Publish `intelligence_service/runtime/active_index.json` only if both stores validate as ready

### Important environment variables

- `INTELLIGENCE_BUNDLE_SOURCE_PATH`
- `INTELLIGENCE_EMBEDDING_ENDPOINT_URL`
- `INTELLIGENCE_EMBEDDING_ENDPOINT_FORMAT`
- `INTELLIGENCE_EMBEDDING_API_KEY`
- `INTELLIGENCE_EMBEDDING_MODEL`
- `QDRANT_URL`
- `QDRANT_API_KEY`
- `NEO4J_URL`
- `NEO4J_USERNAME`
- `NEO4J_PASSWORD`
