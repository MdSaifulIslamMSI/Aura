from __future__ import annotations

import asyncio
import hashlib
import math
from typing import Sequence
from urllib.parse import urlparse

import httpx
from huggingface_hub import InferenceClient

from .config import settings


def _normalize_texts(texts: Sequence[str]) -> list[str]:
    return [str(text or "") for text in texts]


def _looks_like_url(value: str) -> bool:
    parsed = urlparse(str(value or "").strip())
    return parsed.scheme in {"http", "https"}


def _coerce_vector(value: object) -> list[float]:
    if hasattr(value, "tolist"):
        value = value.tolist()

    if isinstance(value, list) and value and all(not isinstance(item, list) for item in value):
        return [float(item) for item in value]

    if isinstance(value, list) and value and all(isinstance(item, list) for item in value):
        rows = [
            [float(component) for component in row]
            for row in value
            if isinstance(row, list) and row
        ]
        if not rows:
            return []
        if len(rows) == 1:
            return rows[0]

        width = min(len(row) for row in rows)
        if width <= 0:
            return []
        return [
            sum(row[index] for row in rows) / len(rows)
            for index in range(width)
        ]

    raise ValueError("Embedding response was not a vector or matrix.")


class EmbeddingClient:
    def __init__(self, client: httpx.AsyncClient | None = None) -> None:
        self._client = client or httpx.AsyncClient(timeout=60.0)
        self._owns_client = client is None

    async def close(self) -> None:
        if self._owns_client:
            await self._client.aclose()

    async def embed(self, texts: Sequence[str]) -> list[list[float]]:
        normalized_texts = _normalize_texts(texts)
        if not normalized_texts:
            return []

        endpoint_format = settings.embedding_endpoint_format.lower()
        if endpoint_format in {"", "deterministic", "local_deterministic"} or not settings.embedding_endpoint_url:
            return [self._deterministic_embedding(text) for text in normalized_texts]

        if endpoint_format in {"openai", "openai_embeddings"}:
            return await self._embed_openai_compatible(normalized_texts)
        if endpoint_format in {"huggingface_hub", "hf_feature_extraction", "huggingface_feature_extraction"}:
            return await self._embed_huggingface_hub(normalized_texts)

        raise ValueError(
            f"Unsupported embedding endpoint format '{settings.embedding_endpoint_format}'. "
            "Use 'deterministic', 'openai_embeddings', or 'huggingface_hub'."
        )

    def _deterministic_embedding(self, text: str) -> list[float]:
        vector_size = max(8, int(settings.embedding_vector_size or 256))
        vector = [0.0] * vector_size
        tokens = [token for token in text.lower().split() if token]
        if not tokens:
            return vector

        for index, token in enumerate(tokens):
            digest = hashlib.sha256(f"{index}:{token}".encode("utf-8")).digest()
            first_bucket = int.from_bytes(digest[:4], "big") % vector_size
            second_bucket = int.from_bytes(digest[4:8], "big") % vector_size
            sign = 1.0 if digest[8] % 2 == 0 else -1.0
            weight = 1.0 + (min(len(token), 24) / 24)
            vector[first_bucket] += sign * weight
            vector[second_bucket] -= sign * (weight / 2)

        norm = math.sqrt(sum(component * component for component in vector))
        if norm == 0:
            return vector
        return [component / norm for component in vector]

    async def _embed_openai_compatible(self, texts: list[str]) -> list[list[float]]:
        headers = {
            "Content-Type": "application/json",
        }
        if settings.embedding_api_key:
            headers["Authorization"] = f"Bearer {settings.embedding_api_key}"

        payload: dict[str, object] = {
            "input": texts,
        }
        if settings.embedding_model:
            payload["model"] = settings.embedding_model

        response = await self._client.post(
            settings.embedding_endpoint_url,
            headers=headers,
            json=payload,
        )
        response.raise_for_status()

        body = response.json()
        data = body.get("data")
        if not isinstance(data, list):
            raise ValueError("Embedding endpoint returned an unexpected payload shape.")

        ordered_vectors = sorted(data, key=lambda item: int(item.get("index", 0)))
        vectors = [item.get("embedding") for item in ordered_vectors]
        if len(vectors) != len(texts) or not all(isinstance(vector, list) for vector in vectors):
            raise ValueError("Embedding endpoint did not return one embedding per input item.")
        return vectors

    async def _embed_huggingface_hub(self, texts: list[str]) -> list[list[float]]:
        return await asyncio.to_thread(self._embed_huggingface_hub_sync, texts)

    def _embed_huggingface_hub_sync(self, texts: list[str]) -> list[list[float]]:
        client_kwargs: dict[str, str] = {}
        if settings.embedding_api_key:
            client_kwargs["api_key"] = settings.embedding_api_key
        if _looks_like_url(settings.embedding_endpoint_url):
            client_kwargs["base_url"] = settings.embedding_endpoint_url

        client = InferenceClient(**client_kwargs)
        model = settings.embedding_model or None
        if not model and not _looks_like_url(settings.embedding_endpoint_url):
            raise ValueError("A Hugging Face embedding model is required when no embedding endpoint URL is set.")

        vectors: list[list[float]] = []
        for text in texts:
            response = client.feature_extraction(
                text,
                model=model or settings.embedding_endpoint_url or None,
            )
            vectors.append(_coerce_vector(response))
        return vectors
