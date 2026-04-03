from __future__ import annotations

import asyncio
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import Depends, FastAPI, Header, HTTPException
from pydantic import BaseModel

from .config import settings
from .embeddings import EmbeddingClient
from .index_state import read_active_index, write_active_index
from .neo4j_store import Neo4jStore
from .qdrant_store import QdrantStore

app = FastAPI(title="Aura Intelligence Worker", version="1.0.0")
embedding_client = EmbeddingClient()
qdrant_store = QdrantStore(embedding_client=embedding_client)
neo4j_store = Neo4jStore()


class PublishIndexRequest(BaseModel):
    bundleVersion: str
    qdrantStatus: str = "configured"
    neo4jStatus: str = "configured"
    notes: str = ""


class IngestIndexRequest(BaseModel):
    bundlePath: str = ""
    publish: bool = True
    recreateStores: bool = False
    notes: str = ""


def _verify_service_auth(authorization: str = Header(default="")) -> None:
    if settings.service_token and authorization.strip() != f"Bearer {settings.service_token}":
        raise HTTPException(status_code=401, detail="Unauthorized intelligence worker request")


def _resolve_bundle_path(raw_path: str = "") -> Path:
    return Path(str(raw_path or settings.bundle_source_path)).expanduser().resolve()


def _load_bundle(bundle_path: Path) -> dict[str, Any]:
    if not bundle_path.exists():
        raise HTTPException(status_code=404, detail=f"Bundle file not found: {bundle_path}")

    try:
        payload = bundle_path.read_text(encoding="utf-8")
        bundle = json.loads(payload)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Unable to load bundle JSON: {exc}") from exc

    required_top_level_keys = ("commitSha", "chunks", "graph")
    missing_keys = [key for key in required_top_level_keys if key not in bundle]
    if missing_keys:
        raise HTTPException(
            status_code=422,
            detail=f"Bundle is missing required keys: {', '.join(missing_keys)}",
        )
    return bundle


def _build_publish_state(
    *,
    bundle_version: str,
    bundle_path: Path,
    qdrant_result: dict[str, Any],
    neo4j_result: dict[str, Any],
    notes: str = "",
) -> dict[str, Any]:
    return {
        "status": "ready",
        "bundleVersion": bundle_version,
        "bundlePath": str(bundle_path),
        "publishedAt": datetime.now(timezone.utc).isoformat(),
        "stores": {
            "qdrant": qdrant_result,
            "neo4j": neo4j_result,
        },
        "notes": notes,
    }


@app.get("/health")
async def health() -> dict[str, Any]:
    qdrant_health, neo4j_health = await asyncio.gather(
        qdrant_store.health(),
        neo4j_store.health(),
    )
    return {
        "status": "ok",
        "worker": "intelligence-index-worker",
        "bundleSourcePath": str(_resolve_bundle_path()),
        "bundleSourceExists": _resolve_bundle_path().exists(),
        "stores": {
            "qdrant": qdrant_health,
            "neo4j": neo4j_health,
        },
        "activeIndex": read_active_index(),
    }


@app.post("/v1/index/publish", dependencies=[Depends(_verify_service_auth)])
async def publish_index(payload: PublishIndexRequest) -> dict[str, Any]:
    published_state = {
        "status": "ready",
        "bundleVersion": payload.bundleVersion,
        "publishedAt": datetime.now(timezone.utc).isoformat(),
        "stores": {
            "qdrant": payload.qdrantStatus,
            "neo4j": payload.neo4jStatus,
        },
        "notes": payload.notes,
    }
    return write_active_index(published_state)


@app.post("/v1/index/ingest", dependencies=[Depends(_verify_service_auth)])
async def ingest_index(payload: IngestIndexRequest) -> dict[str, Any]:
    bundle_path = _resolve_bundle_path(payload.bundlePath)
    bundle = _load_bundle(bundle_path)
    bundle_version = str(bundle.get("commitSha") or "").strip() or "dev-local"

    qdrant_result, neo4j_result = await asyncio.gather(
        qdrant_store.ingest_bundle(bundle, recreate=payload.recreateStores),
        neo4j_store.ingest_bundle(bundle, recreate=payload.recreateStores),
    )

    qdrant_ready = qdrant_result.get("status") == "ready"
    neo4j_ready = neo4j_result.get("status") == "ready"
    stores_ready = qdrant_ready and neo4j_ready

    active_index = read_active_index()
    published = False
    if payload.publish and stores_ready:
        active_index = write_active_index(
            _build_publish_state(
                bundle_version=bundle_version,
                bundle_path=bundle_path,
                qdrant_result=qdrant_result,
                neo4j_result=neo4j_result,
                notes=payload.notes,
            )
        )
        published = True

    return {
        "status": "ready" if stores_ready else "not_ready",
        "bundleVersion": bundle_version,
        "bundlePath": str(bundle_path),
        "published": published,
        "validatedAt": datetime.now(timezone.utc).isoformat(),
        "chunks": {
            "expected": len(bundle.get("chunks") or []),
            "indexed": qdrant_result.get("indexedChunks", 0),
        },
        "graph": {
            "expectedNodes": len((bundle.get("graph") or {}).get("nodes") or []),
            "indexedNodes": neo4j_result.get("indexedNodes", 0),
            "expectedEdges": len((bundle.get("graph") or {}).get("edges") or []),
            "indexedEdges": neo4j_result.get("indexedEdges", 0),
        },
        "stores": {
            "qdrant": qdrant_result,
            "neo4j": neo4j_result,
        },
        "activeIndex": active_index,
        "notes": payload.notes,
    }


@app.on_event("shutdown")
async def shutdown_event() -> None:
    await qdrant_store.close()
    await neo4j_store.close()
    await embedding_client.close()
