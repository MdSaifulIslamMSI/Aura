from __future__ import annotations

import asyncio
import re
import uuid
from typing import Any, Iterable

from qdrant_client import QdrantClient, models

from .config import settings
from .embeddings import EmbeddingClient


def _chunked(values: list[dict[str, Any]], size: int) -> Iterable[list[dict[str, Any]]]:
    batch_size = max(1, int(size or 1))
    for index in range(0, len(values), batch_size):
        yield values[index:index + batch_size]


def _sanitize_collection_name(prefix: str, bundle_version: str) -> str:
    raw = f"{prefix}_{bundle_version}".strip("_").lower()
    sanitized = re.sub(r"[^a-z0-9_]+", "_", raw)
    collapsed = re.sub(r"_+", "_", sanitized).strip("_")
    return (collapsed or "aura_code_chunks")[:120]


class QdrantStore:
    def __init__(
        self,
        *,
        embedding_client: EmbeddingClient | None = None,
    ) -> None:
        self.embedding_client = embedding_client or EmbeddingClient()
        self._client: QdrantClient | None = None

    @property
    def configured(self) -> bool:
        return bool(settings.qdrant_url)

    async def close(self) -> None:
        if self._client is not None and hasattr(self._client, "close"):
            await asyncio.to_thread(self._client.close)
        self._client = None

    def build_collection_name(self, bundle_version: str) -> str:
        return _sanitize_collection_name(settings.qdrant_collection_prefix, bundle_version)

    async def health(self) -> dict[str, Any]:
        if not self.configured:
            return {
                "status": "not_configured",
                "configured": False,
            }

        try:
            collections = await asyncio.to_thread(self._get_client().get_collections)
            items = getattr(collections, "collections", collections)
            return {
                "status": "ok",
                "configured": True,
                "collectionCount": len(items),
            }
        except Exception as exc:
            return {
                "status": "error",
                "configured": True,
                "reason": str(exc),
            }

    async def ingest_bundle(self, bundle: dict[str, Any], *, recreate: bool = False) -> dict[str, Any]:
        bundle_version = str(bundle.get("commitSha") or "").strip() or "dev-local"
        chunks = list(bundle.get("chunks") or [])

        if not self.configured:
            return {
                "status": "not_configured",
                "configured": False,
                "bundleVersion": bundle_version,
                "expectedChunks": len(chunks),
            }

        if not chunks:
            return {
                "status": "empty",
                "configured": True,
                "bundleVersion": bundle_version,
                "expectedChunks": 0,
            }

        collection_name = self.build_collection_name(bundle_version)
        if recreate:
            await self._delete_collection(collection_name)

        first_batch = chunks[: max(1, settings.embedding_batch_size)]
        first_vectors = await self.embedding_client.embed([chunk.get("text", "") for chunk in first_batch])
        vector_size = len(first_vectors[0]) if first_vectors and first_vectors[0] else settings.embedding_vector_size
        await self._ensure_collection(collection_name, vector_size)
        await self._upsert_points(collection_name, bundle_version, first_batch, first_vectors)

        for batch in _chunked(chunks[len(first_batch):], settings.qdrant_upsert_batch_size):
            vectors = await self.embedding_client.embed([chunk.get("text", "") for chunk in batch])
            await self._upsert_points(collection_name, bundle_version, batch, vectors)

        indexed_chunks = await self._count_points(collection_name)
        return {
            "status": "ready" if indexed_chunks == len(chunks) else "count_mismatch",
            "configured": True,
            "bundleVersion": bundle_version,
            "collection": collection_name,
            "embeddingFormat": settings.embedding_endpoint_format,
            "embeddingModel": settings.embedding_model,
            "vectorSize": vector_size,
            "indexedChunks": indexed_chunks,
            "expectedChunks": len(chunks),
        }

    async def search_chunks(
        self,
        *,
        bundle_version: str,
        query: str,
        limit: int = 6,
        subsystem: str = "",
    ) -> list[dict[str, Any]]:
        normalized_bundle_version = str(bundle_version or "").strip() or "dev-local"
        normalized_query = str(query or "").strip()
        normalized_subsystem = str(subsystem or "").strip()
        normalized_limit = max(1, min(int(limit or 6), 12))

        if not self.configured or not normalized_query:
            return []

        collection_name = self.build_collection_name(normalized_bundle_version)
        if not await self._collection_exists(collection_name):
            return []

        query_vectors = await self.embedding_client.embed([normalized_query])
        query_vector = query_vectors[0] if query_vectors else []
        if not query_vector:
            return []

        query_filter = None
        if normalized_subsystem:
            query_filter = models.Filter(
                must=[
                    models.FieldCondition(
                        key="subsystem",
                        match=models.MatchValue(value=normalized_subsystem),
                    )
                ]
            )

        try:
            search_result = await asyncio.to_thread(
                self._get_client().search,
                collection_name=collection_name,
                query_vector=query_vector,
                limit=normalized_limit,
                query_filter=query_filter,
                with_payload=True,
            )
        except Exception:
            return []

        results: list[dict[str, Any]] = []
        for point in search_result or []:
            payload = getattr(point, "payload", {}) or {}
            path = str(payload.get("path") or "").strip()
            start_line = int(payload.get("startLine") or 0)
            label = f"{path}:{start_line}" if path and start_line > 0 else path
            results.append(
                {
                    "id": str(payload.get("chunkId") or getattr(point, "id", "")),
                    "label": label,
                    "type": "doc" if str(payload.get("subsystem") or "") == "docs" else "code",
                    "path": path,
                    "excerpt": str(payload.get("text") or "").strip(),
                    "startLine": start_line,
                    "endLine": int(payload.get("endLine") or 0),
                    "score": float(getattr(point, "score", 0.0) or 0.0),
                    "metadata": {
                        "subsystem": str(payload.get("subsystem") or "").strip(),
                        "bundleVersion": str(payload.get("bundleVersion") or normalized_bundle_version).strip(),
                        "keywords": payload.get("keywords", []),
                    },
                }
            )
        return results

    async def _ensure_collection(self, collection_name: str, vector_size: int) -> None:
        if await self._collection_exists(collection_name):
            return

        distance_name = str(settings.qdrant_distance or "Cosine").upper()
        distance = getattr(models.Distance, distance_name, models.Distance.COSINE)
        await asyncio.to_thread(
            self._get_client().create_collection,
            collection_name=collection_name,
            vectors_config=models.VectorParams(size=int(vector_size), distance=distance),
        )

    async def _collection_exists(self, collection_name: str) -> bool:
        return await asyncio.to_thread(self._get_client().collection_exists, collection_name)

    async def _delete_collection(self, collection_name: str) -> None:
        if not await self._collection_exists(collection_name):
            return
        await asyncio.to_thread(self._get_client().delete_collection, collection_name)

    async def _upsert_points(
        self,
        collection_name: str,
        bundle_version: str,
        chunk_batch: list[dict[str, Any]],
        vector_batch: list[list[float]],
    ) -> None:
        if len(chunk_batch) != len(vector_batch):
            raise ValueError("Embedding count does not match the chunk batch size.")

        points: list[models.PointStruct] = []
        for chunk, vector in zip(chunk_batch, vector_batch):
            chunk_id = str(chunk.get("id") or "")
            points.append(
                models.PointStruct(
                    id=str(uuid.uuid5(uuid.NAMESPACE_URL, f"{bundle_version}:{chunk_id}")),
                    vector=vector,
                    payload={
                        "chunkId": chunk_id,
                        "bundleVersion": bundle_version,
                        "path": chunk.get("path"),
                        "subsystem": chunk.get("subsystem"),
                        "startLine": chunk.get("startLine"),
                        "endLine": chunk.get("endLine"),
                        "keywords": chunk.get("keywords", []),
                        "text": chunk.get("text", ""),
                    },
                )
            )

        await asyncio.to_thread(
            self._get_client().upsert,
            collection_name=collection_name,
            points=points,
            wait=True,
        )

    async def _count_points(self, collection_name: str) -> int:
        result = await asyncio.to_thread(
            self._get_client().count,
            collection_name=collection_name,
            exact=True,
        )
        return int(getattr(result, "count", 0))

    def _get_client(self) -> QdrantClient:
        if self._client is None:
            self._client = QdrantClient(
                url=settings.qdrant_url,
                api_key=settings.qdrant_api_key or None,
            )
        return self._client
