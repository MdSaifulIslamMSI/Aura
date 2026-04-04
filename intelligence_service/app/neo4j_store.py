from __future__ import annotations

import asyncio
from typing import Any, Iterable

from neo4j import GraphDatabase

from .config import settings


def _chunked(values: list[dict[str, Any]], size: int) -> Iterable[list[dict[str, Any]]]:
    batch_size = max(1, int(size or 1))
    for index in range(0, len(values), batch_size):
        yield values[index:index + batch_size]


class Neo4jStore:
    def __init__(self) -> None:
        self._driver = None

    @property
    def configured(self) -> bool:
        return bool(settings.neo4j_url and settings.neo4j_username and settings.neo4j_password)

    async def close(self) -> None:
        if self._driver is not None:
            await asyncio.to_thread(self._driver.close)
            self._driver = None

    async def health(self) -> dict[str, Any]:
        if not self.configured:
            return {
                "status": "not_configured",
                "configured": False,
            }

        try:
            await asyncio.to_thread(self._verify_connectivity)
            return {
                "status": "ok",
                "configured": True,
            }
        except Exception as exc:
            return {
                "status": "error",
                "configured": True,
                "reason": str(exc),
            }

    async def ingest_bundle(self, bundle: dict[str, Any], *, recreate: bool = False) -> dict[str, Any]:
        bundle_version = str(bundle.get("commitSha") or "").strip() or "dev-local"
        graph = bundle.get("graph") or {}
        nodes = list(graph.get("nodes") or [])
        edges = list(graph.get("edges") or [])

        if not self.configured:
            return {
                "status": "not_configured",
                "configured": False,
                "bundleVersion": bundle_version,
                "expectedNodes": len(nodes),
                "expectedEdges": len(edges),
            }

        if not nodes:
            return {
                "status": "empty",
                "configured": True,
                "bundleVersion": bundle_version,
                "expectedNodes": 0,
                "expectedEdges": len(edges),
            }

        return await asyncio.to_thread(
            self._ingest_bundle_sync,
            bundle_version,
            nodes,
            edges,
            recreate,
        )

    async def trace_paths(
        self,
        *,
        bundle_version: str,
        query: str,
        limit: int = 4,
    ) -> list[dict[str, Any]]:
        normalized_bundle_version = str(bundle_version or "").strip() or "dev-local"
        terms = [
            term.strip().lower()
            for term in str(query or "").split()
            if term and len(term.strip()) >= 2
        ]
        normalized_limit = max(1, min(int(limit or 4), 8))

        if not self.configured or not terms:
            return []

        return await asyncio.to_thread(
            self._trace_paths_sync,
            normalized_bundle_version,
            terms,
            normalized_limit,
        )

    def _ingest_bundle_sync(
        self,
        bundle_version: str,
        nodes: list[dict[str, Any]],
        edges: list[dict[str, Any]],
        recreate: bool,
    ) -> dict[str, Any]:
        driver = self._get_driver()
        driver.verify_connectivity()

        driver.execute_query(
            """
            MATCH (node:CodeEntity {bundleVersion: $bundle_version})
            DETACH DELETE node
            """,
            bundle_version=bundle_version,
            database_=settings.neo4j_database,
        )

        for batch in _chunked(nodes, settings.neo4j_batch_size):
            driver.execute_query(
                """
                UNWIND $rows AS row
                MERGE (node:CodeEntity {bundleVersion: $bundle_version, id: row.id})
                SET node.type = row.type,
                    node.label = row.label,
                    node.path = row.path,
                    node.subsystem = row.subsystem
                """,
                bundle_version=bundle_version,
                rows=batch,
                database_=settings.neo4j_database,
            )

        edge_rows = [
            {
                "sourceId": edge.get("from"),
                "targetId": edge.get("to"),
                "type": edge.get("type", "related"),
            }
            for edge in edges
            if edge.get("from") and edge.get("to")
        ]

        for batch in _chunked(edge_rows, settings.neo4j_batch_size):
            driver.execute_query(
                """
                UNWIND $rows AS row
                MATCH (source:CodeEntity {bundleVersion: $bundle_version, id: row.sourceId})
                MATCH (target:CodeEntity {bundleVersion: $bundle_version, id: row.targetId})
                MERGE (source)-[rel:RELATES_TO {bundleVersion: $bundle_version, type: row.type}]->(target)
                """,
                bundle_version=bundle_version,
                rows=batch,
                database_=settings.neo4j_database,
            )

        node_records, _, _ = driver.execute_query(
            """
            MATCH (node:CodeEntity {bundleVersion: $bundle_version})
            RETURN count(node) AS count
            """,
            bundle_version=bundle_version,
            database_=settings.neo4j_database,
        )
        edge_records, _, _ = driver.execute_query(
            """
            MATCH (:CodeEntity {bundleVersion: $bundle_version})-[rel:RELATES_TO {bundleVersion: $bundle_version}]->(:CodeEntity {bundleVersion: $bundle_version})
            RETURN count(rel) AS count
            """,
            bundle_version=bundle_version,
            database_=settings.neo4j_database,
        )

        indexed_nodes = int(node_records[0]["count"]) if node_records else 0
        indexed_edges = int(edge_records[0]["count"]) if edge_records else 0
        return {
            "status": "ready" if indexed_nodes == len(nodes) and indexed_edges == len(edge_rows) else "count_mismatch",
            "configured": True,
            "bundleVersion": bundle_version,
            "indexedNodes": indexed_nodes,
            "expectedNodes": len(nodes),
            "indexedEdges": indexed_edges,
            "expectedEdges": len(edge_rows),
            "database": settings.neo4j_database,
        }

    def _trace_paths_sync(
        self,
        bundle_version: str,
        terms: list[str],
        limit: int,
    ) -> list[dict[str, Any]]:
        driver = self._get_driver()
        query = """
        MATCH (focus:CodeEntity {bundleVersion: $bundle_version})
        WITH focus,
             reduce(score = 0, term IN $terms |
                score +
                CASE
                    WHEN toLower(coalesce(focus.label, '')) CONTAINS term
                      OR toLower(coalesce(focus.path, '')) CONTAINS term
                    THEN 1 ELSE 0
                END
             ) AS score
        WHERE score > 0
        ORDER BY score DESC, focus.label ASC
        LIMIT $limit
        OPTIONAL MATCH (focus)-[rel:RELATES_TO {bundleVersion: $bundle_version}]-(neighbor:CodeEntity {bundleVersion: $bundle_version})
        WITH focus, score, collect({
            type: rel.type,
            from: {
                id: focus.id,
                type: focus.type,
                label: focus.label,
                path: focus.path,
                subsystem: focus.subsystem
            },
            to: CASE
                WHEN neighbor IS NULL THEN null
                ELSE {
                    id: neighbor.id,
                    type: neighbor.type,
                    label: neighbor.label,
                    path: neighbor.path,
                    subsystem: neighbor.subsystem
                }
            END
        })[0..8] AS steps
        RETURN {
            focus: {
                id: focus.id,
                type: focus.type,
                label: focus.label,
                path: focus.path,
                subsystem: focus.subsystem
            },
            summary: 'Matched graph entity ' + coalesce(focus.label, focus.path, focus.id),
            steps: [step IN steps WHERE step.type IS NOT NULL AND step.to IS NOT NULL],
            score: score
        } AS trace
        ORDER BY trace.score DESC
        """
        records, _, _ = driver.execute_query(
            query,
            bundle_version=bundle_version,
            terms=terms,
            limit=limit,
            database_=settings.neo4j_database,
        )
        return [record["trace"] for record in records if record.get("trace")]

    def _verify_connectivity(self) -> None:
        self._get_driver().verify_connectivity()

    def _get_driver(self):
        if self._driver is None:
            self._driver = GraphDatabase.driver(
                settings.neo4j_url,
                auth=(settings.neo4j_username, settings.neo4j_password),
            )
        return self._driver
