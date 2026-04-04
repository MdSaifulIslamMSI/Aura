from __future__ import annotations

import asyncio
import json
import re
from pathlib import Path
from typing import Any

from .config import settings


def _safe_string(value: Any = "") -> str:
    return str(value or "").strip()


def _normalize_path(value: Any = "") -> str:
    return _safe_string(value).replace("\\", "/")


def _tokenize(value: Any = "") -> list[str]:
    tokens: list[str] = []
    for entry in re.split(r"[^a-z0-9_:/.-]+", _safe_string(value).lower()):
        token = entry.strip()
        if len(token) < 2 or token in tokens:
            continue
        tokens.append(token)
    return tokens


def _score_text_against_terms(*, text: Any = "", path: Any = "", terms: list[str] | None = None) -> int:
    normalized_terms = list(terms or [])
    if not normalized_terms:
        return 0

    haystack = f"{_safe_string(path)} {_safe_string(text)}".lower()
    score = 0
    for term in normalized_terms:
        if not term:
            continue
        if term in haystack:
            score += 2
        if re.search(rf"\b{re.escape(term)}\b", haystack, flags=re.IGNORECASE):
            score += 3
    return score


class BundleStore:
    def __init__(self, *, bundle_path: Path | None = None) -> None:
        self.bundle_path = Path(bundle_path or settings.bundle_source_path)
        self._cached_bundle: dict[str, Any] | None = None
        self._cached_signature: tuple[str, int, int] | None = None

    async def close(self) -> None:
        return None

    async def get_bundle_version(self) -> str:
        return await asyncio.to_thread(self._get_bundle_version_sync)

    async def search_code_chunks(
        self,
        *,
        query: str,
        limit: int = 6,
        subsystem: str = "",
    ) -> list[dict[str, Any]]:
        return await asyncio.to_thread(
            self._search_code_chunks_sync,
            query,
            limit,
            subsystem,
        )

    async def get_file_section(
        self,
        *,
        target_path: str = "",
        start_line: int = 0,
        end_line: int = 0,
        around_line: int = 0,
        radius: int = 12,
    ) -> dict[str, Any] | None:
        return await asyncio.to_thread(
            self._get_file_section_sync,
            target_path,
            start_line,
            end_line,
            around_line,
            radius,
        )

    async def trace_system_path(
        self,
        *,
        query: str,
        limit: int = 4,
    ) -> list[dict[str, Any]]:
        return await asyncio.to_thread(self._trace_system_path_sync, query, limit)

    async def get_route_contract(self, *, endpoint: str = "") -> list[dict[str, Any]]:
        return await asyncio.to_thread(self._get_route_contract_sync, endpoint)

    async def get_model_schema(self, *, model_name: str = "") -> list[dict[str, Any]]:
        return await asyncio.to_thread(self._get_model_schema_sync, model_name)

    def _load_bundle(self) -> dict[str, Any] | None:
        try:
            resolved_path = self.bundle_path.resolve()
            stats = resolved_path.stat()
        except OSError:
            self._cached_bundle = None
            self._cached_signature = None
            return None

        signature = (str(resolved_path), int(stats.st_mtime_ns), int(stats.st_size))
        if self._cached_bundle is not None and self._cached_signature == signature:
            return self._cached_bundle

        try:
            payload = json.loads(resolved_path.read_text(encoding="utf-8"))
        except Exception:
            self._cached_bundle = None
            self._cached_signature = None
            return None

        if not isinstance(payload, dict):
            self._cached_bundle = None
            self._cached_signature = None
            return None

        self._cached_bundle = payload
        self._cached_signature = signature
        return payload

    def _get_bundle_version_sync(self) -> str:
        bundle = self._load_bundle()
        return _safe_string((bundle or {}).get("commitSha")) or "dev-local"

    def _search_code_chunks_sync(
        self,
        query: str,
        limit: int,
        subsystem: str,
    ) -> list[dict[str, Any]]:
        bundle = self._load_bundle()
        terms = _tokenize(query)
        normalized_subsystem = _safe_string(subsystem)
        normalized_limit = max(1, min(int(limit or 6), 12))
        if not bundle or not terms:
            return []

        matches = []
        for chunk in bundle.get("chunks") or []:
            if normalized_subsystem and _safe_string(chunk.get("subsystem")) != normalized_subsystem:
                continue
            score_value = _score_text_against_terms(
                text=chunk.get("text"),
                path=chunk.get("path"),
                terms=terms,
            )
            if score_value <= 0:
                continue
            matches.append((score_value, chunk))

        matches.sort(key=lambda entry: entry[0], reverse=True)
        results: list[dict[str, Any]] = []
        for score_value, chunk in matches[:normalized_limit]:
            results.append(
                {
                    "id": _safe_string(chunk.get("id")),
                    "label": f"{_safe_string(chunk.get('path'))}:{int(chunk.get('startLine') or 0)}",
                    "type": "doc" if _safe_string(chunk.get("subsystem")) == "docs" else "code",
                    "path": _safe_string(chunk.get("path")),
                    "excerpt": _safe_string(chunk.get("text")),
                    "startLine": int(chunk.get("startLine") or 0),
                    "endLine": int(chunk.get("endLine") or 0),
                    "score": min(1.0, score_value / max(len(terms) * 5, 1)),
                    "metadata": {
                        "subsystem": _safe_string(chunk.get("subsystem")),
                        "bundleVersion": self._get_bundle_version_sync(),
                    },
                }
            )
        return results

    def _resolve_file_entry(self, target_path: str) -> dict[str, Any] | None:
        bundle = self._load_bundle()
        if not bundle:
            return None

        normalized_target = _normalize_path(target_path).lower()
        if not normalized_target:
            return None

        files = list(bundle.get("files") or [])
        exact_matches = [
            entry for entry in files
            if _normalize_path(entry.get("path")).lower() == normalized_target
        ]
        if exact_matches:
            return exact_matches[0]

        suffix_matches = [
            entry for entry in files
            if _normalize_path(entry.get("path")).lower().endswith(f"/{normalized_target}")
            or _normalize_path(entry.get("path")).lower() == normalized_target
        ]
        if len(suffix_matches) == 1:
            return suffix_matches[0]

        basename_matches = [
            entry for entry in files
            if Path(_normalize_path(entry.get("path"))).name.lower() == Path(normalized_target).name.lower()
        ]
        if len(basename_matches) == 1:
            return basename_matches[0]

        return None

    def _get_file_section_sync(
        self,
        target_path: str,
        start_line: int,
        end_line: int,
        around_line: int,
        radius: int,
    ) -> dict[str, Any] | None:
        file_entry = self._resolve_file_entry(target_path)
        content = _safe_string((file_entry or {}).get("content"))
        if not file_entry or not content:
            return None

        lines = content.splitlines()
        if not lines:
            return None

        normalized_start_line = int(start_line or 0)
        normalized_end_line = int(end_line or 0)
        normalized_around_line = int(around_line or 0)
        normalized_radius = max(1, int(radius or 12))

        resolved_start = max(
            1,
            normalized_start_line
            or (normalized_around_line - normalized_radius if normalized_around_line > 0 else 1),
        )
        resolved_end = min(
            len(lines),
            normalized_end_line
            or (normalized_around_line + normalized_radius if normalized_around_line > 0 else resolved_start + normalized_radius),
        )

        return {
            "path": _safe_string(file_entry.get("path")),
            "subsystem": _safe_string(file_entry.get("subsystem")),
            "startLine": resolved_start,
            "endLine": resolved_end,
            "content": "\n".join(lines[resolved_start - 1:resolved_end]),
        }

    def _trace_system_path_sync(self, query: str, limit: int) -> list[dict[str, Any]]:
        bundle = self._load_bundle()
        terms = _tokenize(query)
        normalized_limit = max(1, min(int(limit or 4), 8))
        if not bundle or not terms:
            return []

        graph = bundle.get("graph") or {}
        nodes = list(graph.get("nodes") or [])
        edges = list(graph.get("edges") or [])
        node_lookup = {
            _safe_string(node.get("id")): node
            for node in nodes
            if _safe_string(node.get("id"))
        }

        scored_nodes = []
        for node in nodes:
            score_value = _score_text_against_terms(
                text=f"{_safe_string(node.get('label'))} {_safe_string(node.get('path'))}",
                path=node.get("path"),
                terms=terms,
            )
            if score_value <= 0:
                continue
            scored_nodes.append((score_value, node))

        scored_nodes.sort(key=lambda entry: entry[0], reverse=True)
        traces: list[dict[str, Any]] = []
        for score_value, node in scored_nodes[:normalized_limit]:
            related_edges = [
                edge for edge in edges
                if _safe_string(edge.get("from")) == _safe_string(node.get("id"))
                or _safe_string(edge.get("to")) == _safe_string(node.get("id"))
            ][:8]

            steps = []
            for edge in related_edges:
                from_node = node_lookup.get(_safe_string(edge.get("from")))
                to_node = node_lookup.get(_safe_string(edge.get("to")))
                steps.append(
                    {
                        "type": _safe_string(edge.get("type")),
                        "from": from_node,
                        "to": to_node,
                    }
                )

            traces.append(
                {
                    "focus": node,
                    "summary": f"Matched bundle graph entity {_safe_string(node.get('label')) or _safe_string(node.get('path')) or _safe_string(node.get('id'))}",
                    "steps": steps,
                    "score": score_value,
                }
            )
        return traces

    def _get_route_contract_sync(self, endpoint: str) -> list[dict[str, Any]]:
        bundle = self._load_bundle()
        normalized_endpoint = _normalize_path(endpoint).lower()
        if not bundle or not normalized_endpoint:
            return []

        matches = []
        for route in bundle.get("routeMap") or []:
            full_path = _normalize_path(route.get("fullPath")).lower()
            local_path = _normalize_path(route.get("path")).lower()
            if (
                full_path == normalized_endpoint
                or normalized_endpoint in full_path
                or local_path == normalized_endpoint
                or normalized_endpoint in local_path
            ):
                matches.append(route)
        return matches[:10]

    def _get_model_schema_sync(self, model_name: str) -> list[dict[str, Any]]:
        bundle = self._load_bundle()
        normalized_model_name = _safe_string(model_name).lower()
        if not bundle or not normalized_model_name:
            return []

        matches = []
        for model in bundle.get("modelMap") or []:
            candidate_name = _safe_string(model.get("name")).lower()
            if candidate_name == normalized_model_name or normalized_model_name in candidate_name:
                matches.append(model)
        return matches[:10]
