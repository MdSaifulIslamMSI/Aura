from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


def _load_repo_env_file() -> None:
    repo_root = Path(__file__).resolve().parents[2]
    env_path = repo_root / "server" / ".env"
    if not env_path.exists():
        return

    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip()
        if not key or key in os.environ:
            continue
        os.environ[key] = value


_load_repo_env_file()


@dataclass(frozen=True)
class Settings:
    service_token: str
    node_tool_gateway_url: str
    node_tool_gateway_token: str
    reasoning_model: str
    routing_model: str
    reasoning_endpoint_url: str
    routing_endpoint_url: str
    endpoint_api_key: str
    active_index_path: Path
    bundle_source_path: Path
    embedding_endpoint_url: str
    embedding_endpoint_format: str
    embedding_api_key: str
    embedding_model: str
    embedding_vector_size: int
    embedding_batch_size: int
    qdrant_api_key: str
    qdrant_url: str
    qdrant_collection_prefix: str
    qdrant_distance: str
    qdrant_upsert_batch_size: int
    neo4j_url: str
    neo4j_username: str
    neo4j_password: str
    neo4j_database: str
    neo4j_batch_size: int


def _env_int(name: str, default: int) -> int:
    raw = os.getenv(name, "").strip()
    try:
        return int(raw) if raw else default
    except ValueError:
        return default


def load_settings() -> Settings:
    runtime_dir = Path(__file__).resolve().parents[1] / "runtime"
    runtime_dir.mkdir(parents=True, exist_ok=True)

    return Settings(
        service_token=os.getenv("INTELLIGENCE_SERVICE_TOKEN", "").strip(),
        node_tool_gateway_url=os.getenv(
            "NODE_TOOL_GATEWAY_URL",
            "http://localhost:5000/api/internal/ai-tools/run",
        ).strip(),
        node_tool_gateway_token=os.getenv(
            "NODE_TOOL_GATEWAY_TOKEN",
            os.getenv("AI_INTERNAL_TOOL_SECRET", ""),
        ).strip(),
        reasoning_model=os.getenv("INTELLIGENCE_REASONING_MODEL", "google/gemma-4-31B-it:novita").strip(),
        routing_model=os.getenv("INTELLIGENCE_ROUTING_MODEL", "google/gemma-4-31B-it:novita").strip(),
        reasoning_endpoint_url=os.getenv("INTELLIGENCE_REASONING_ENDPOINT_URL", "").strip(),
        routing_endpoint_url=os.getenv("INTELLIGENCE_ROUTING_ENDPOINT_URL", "").strip(),
        endpoint_api_key=os.getenv(
            "INTELLIGENCE_ENDPOINT_API_KEY",
            os.getenv("HF_TOKEN", os.getenv("HUGGINGFACEHUB_API_TOKEN", "")),
        ).strip(),
        active_index_path=Path(os.getenv("INTELLIGENCE_ACTIVE_INDEX_PATH", runtime_dir / "active_index.json")),
        bundle_source_path=Path(
            os.getenv(
                "INTELLIGENCE_BUNDLE_SOURCE_PATH",
                Path(__file__).resolve().parents[2] / "server" / "generated" / "intelligence" / "current" / "bundle.json",
            )
        ),
        embedding_endpoint_url=os.getenv("INTELLIGENCE_EMBEDDING_ENDPOINT_URL", "").strip(),
        embedding_endpoint_format=os.getenv("INTELLIGENCE_EMBEDDING_ENDPOINT_FORMAT", "deterministic").strip(),
        embedding_api_key=os.getenv(
            "INTELLIGENCE_EMBEDDING_API_KEY",
            os.getenv(
                "INTELLIGENCE_ENDPOINT_API_KEY",
                os.getenv("HF_TOKEN", os.getenv("HUGGINGFACEHUB_API_TOKEN", "")),
            ),
        ).strip(),
        embedding_model=os.getenv("INTELLIGENCE_EMBEDDING_MODEL", "intfloat/multilingual-e5-large").strip(),
        embedding_vector_size=_env_int("INTELLIGENCE_EMBEDDING_VECTOR_SIZE", 256),
        embedding_batch_size=_env_int("INTELLIGENCE_EMBEDDING_BATCH_SIZE", 32),
        qdrant_api_key=os.getenv("QDRANT_API_KEY", "").strip(),
        qdrant_url=os.getenv("QDRANT_URL", "").strip(),
        qdrant_collection_prefix=os.getenv("QDRANT_COLLECTION_PREFIX", "aura_code_chunks").strip(),
        qdrant_distance=os.getenv("QDRANT_DISTANCE", "Cosine").strip(),
        qdrant_upsert_batch_size=_env_int("QDRANT_UPSERT_BATCH_SIZE", 128),
        neo4j_url=os.getenv("NEO4J_URL", os.getenv("NEO4J_URI", "")).strip(),
        neo4j_username=os.getenv("NEO4J_USERNAME", "").strip(),
        neo4j_password=os.getenv("NEO4J_PASSWORD", "").strip(),
        neo4j_database=os.getenv("NEO4J_DATABASE", os.getenv("AURA_INSTANCEID", "neo4j")).strip(),
        neo4j_batch_size=_env_int("NEO4J_BATCH_SIZE", 250),
    )


settings = load_settings()
