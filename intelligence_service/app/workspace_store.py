from __future__ import annotations

import asyncio
import re
from pathlib import Path
from typing import Any


SOURCE_DIRECTORIES = ("app", "server", "docs", "infra")
TEXT_FILE_EXTENSIONS = {
    ".js",
    ".jsx",
    ".ts",
    ".tsx",
    ".json",
    ".md",
    ".yml",
    ".yaml",
    ".toml",
    ".ps1",
    ".py",
    ".sh",
}
SKIPPED_PATH_SEGMENTS = {
    ".git",
    ".next",
    ".turbo",
    "build",
    "coverage",
    "dist",
    "node_modules",
    "uploads",
    "__pycache__",
}
MAX_FILE_BYTES = 512_000
DEFAULT_CHUNK_LINE_COUNT = 60
MAX_TRACE_STEPS = 8

IMPORT_PATTERN = re.compile(r"import\s+[^'\"]*?from\s+['\"`]([^'\"`]+)['\"`]")
REQUIRE_PATTERN = re.compile(r"require\(\s*['\"`]([^'\"`]+)['\"`]\s*\)")
API_ENDPOINT_PATTERN = re.compile(r"['\"`](/api/[a-z0-9/_:-]+)['\"`]", re.IGNORECASE)
ROUTE_REQUIRE_PATTERN = re.compile(r"const\s+([A-Za-z0-9_$]+)\s*=\s*require\(\s*['\"`](\.\/routes\/[^'\"`]+)['\"`]\s*\)")
APP_USE_PATTERN = re.compile(r"app\.use\(\s*['\"`]([^'\"`]+)['\"`]\s*,\s*([A-Za-z0-9_$]+)\s*\)")
CHAINED_ROUTE_PATTERN = re.compile(
    r"router\.route\(\s*['\"`]([^'\"`]+)['\"`]\s*\)([\s\S]*?)(?=router\.route\(|module\.exports|$)",
    re.IGNORECASE,
)
ROUTE_METHOD_PATTERN = re.compile(r"\.(get|post|put|patch|delete)\(", re.IGNORECASE)
DIRECT_ROUTE_PATTERN = re.compile(r"router\.(get|post|put|patch|delete|use)\(\s*['\"`]([^'\"`]+)['\"`]", re.IGNORECASE)
MODEL_NAME_PATTERN = re.compile(r"mongoose\.model\(\s*['\"`]([^'\"`]+)['\"`]")
TOP_LEVEL_FIELD_PATTERN = re.compile(r"^\s{4}([A-Za-z0-9_]+)\s*:")


def _safe_string(value: Any = "") -> str:
    return str(value or "").strip()


def _normalize_path(value: Any = "") -> str:
    return _safe_string(value).replace("\\", "/")


def _normalize_route_path(value: Any = "") -> str:
    normalized = f"/{_safe_string(value).lstrip('/')}"
    normalized = re.sub(r"/+", "/", normalized)
    return normalized if normalized == "/" else normalized.rstrip("/")


def _unique(values: list[Any] | tuple[Any, ...] | None = None) -> list[Any]:
    seen = set()
    unique_values = []
    for value in values or []:
        marker = str(value)
        if not value or marker in seen:
            continue
        seen.add(marker)
        unique_values.append(value)
    return unique_values


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


def _detect_subsystem(relative_path: str) -> str:
    normalized_path = _normalize_path(relative_path)
    if normalized_path.startswith("app/"):
        return "frontend"
    if normalized_path.startswith("server/"):
        return "backend"
    if normalized_path.startswith("docs/"):
        return "docs"
    if normalized_path.startswith("infra/"):
        return "infra"
    return "workspace"


def _should_skip_path(path: Path) -> bool:
    normalized_path = _normalize_path(path)
    return any(
        f"/{segment}/" in normalized_path or normalized_path.endswith(f"/{segment}")
        for segment in SKIPPED_PATH_SEGMENTS
    )


def _looks_like_text_source(path: Path) -> bool:
    return path.suffix.lower() in TEXT_FILE_EXTENSIONS


def _resolve_module_candidates(base_path: Path) -> list[Path]:
    return [
        base_path.with_suffix(".js"),
        base_path.with_suffix(".jsx"),
        base_path.with_suffix(".ts"),
        base_path.with_suffix(".tsx"),
        base_path / "index.js",
        base_path / "index.jsx",
        base_path / "index.ts",
        base_path / "index.tsx",
    ]


def _extract_import_requests(content: str = "") -> list[str]:
    imports = [match.group(1).strip() for match in IMPORT_PATTERN.finditer(str(content or ""))]
    imports.extend(match.group(1).strip() for match in REQUIRE_PATTERN.finditer(str(content or "")))
    return _unique(imports)


def _extract_api_endpoints(content: str = "") -> list[str]:
    endpoints = [_normalize_route_path(match.group(1)) for match in API_ENDPOINT_PATTERN.finditer(str(content or ""))]
    return _unique(endpoints)


class WorkspaceStore:
    def __init__(self, *, repo_root: Path | None = None) -> None:
        self.repo_root = Path(repo_root or Path(__file__).resolve().parents[2])

    async def close(self) -> None:
        return None

    async def search_code_chunks(
        self,
        *,
        query: str,
        limit: int = 6,
        subsystem: str = "",
    ) -> list[dict[str, Any]]:
        return await asyncio.to_thread(self._search_code_chunks_sync, query, limit, subsystem)

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

    def _collect_source_files(self) -> list[dict[str, Any]]:
        files: list[dict[str, Any]] = []
        for source_directory in SOURCE_DIRECTORIES:
            absolute_dir = self.repo_root / source_directory
            if not absolute_dir.exists() or _should_skip_path(absolute_dir):
                continue

            for path in absolute_dir.rglob("*"):
                if not path.is_file() or _should_skip_path(path) or not _looks_like_text_source(path):
                    continue
                try:
                    stats = path.stat()
                    if stats.st_size > MAX_FILE_BYTES:
                        continue
                    content = path.read_text(encoding="utf-8")
                except Exception:
                    continue

                relative_path = _normalize_path(path.relative_to(self.repo_root))
                files.append(
                    {
                        "absolutePath": path,
                        "path": relative_path,
                        "subsystem": _detect_subsystem(relative_path),
                        "content": content,
                    }
                )
        files.sort(key=lambda entry: entry["path"])
        return files

    def _resolve_repo_module_path(
        self,
        *,
        importer_path: Path,
        request_path: str,
    ) -> str | None:
        normalized_request = _safe_string(request_path)
        if not normalized_request.startswith("."):
            return None

        candidate_base = (importer_path.parent / normalized_request).resolve()
        for candidate in _resolve_module_candidates(candidate_base):
            if candidate.exists():
                return _normalize_path(candidate.relative_to(self.repo_root))
        return None

    def _resolve_file_entry(self, target_path: str) -> dict[str, Any] | None:
        normalized_target = _normalize_path(target_path).lower()
        if not normalized_target:
            return None

        files = self._collect_source_files()
        exact_matches = [entry for entry in files if _normalize_path(entry.get("path")).lower() == normalized_target]
        if exact_matches:
            return exact_matches[0]

        suffix_matches = [
            entry
            for entry in files
            if _normalize_path(entry.get("path")).lower().endswith(f"/{normalized_target}")
            or _normalize_path(entry.get("path")).lower() == normalized_target
        ]
        if len(suffix_matches) == 1:
            return suffix_matches[0]

        basename = Path(normalized_target).name
        basename_matches = [
            entry for entry in files if Path(_normalize_path(entry.get("path"))).name.lower() == basename
        ]
        if len(basename_matches) == 1:
            return basename_matches[0]
        return None

    def _build_backend_dependency_index(self, source_files: list[dict[str, Any]]) -> dict[str, dict[str, list[str]]]:
        dependency_index: dict[str, dict[str, list[str]]] = {}
        for file_entry in source_files:
            file_path = _safe_string(file_entry.get("path"))
            if not file_path.startswith("server/"):
                continue

            import_requests = _extract_import_requests(_safe_string(file_entry.get("content")))
            resolved_imports = _unique(
                [
                    self._resolve_repo_module_path(
                        importer_path=file_entry["absolutePath"],
                        request_path=request_path,
                    )
                    for request_path in import_requests
                ]
            )
            resolved_imports = [entry for entry in resolved_imports if entry]

            dependency_index[file_path] = {
                "imports": resolved_imports,
                "serviceRefs": [entry for entry in resolved_imports if entry.startswith("server/services/")],
                "modelRefs": [entry for entry in resolved_imports if entry.startswith("server/models/")],
                "controllerRefs": [entry for entry in resolved_imports if entry.startswith("server/controllers/")],
            }
        return dependency_index

    def _extract_mount_map(self, source_files: list[dict[str, Any]]) -> dict[str, str]:
        index_file = next((file_entry for file_entry in source_files if file_entry.get("path") == "server/index.js"), None)
        if not index_file:
            return {}

        require_map: dict[str, str] = {}
        for match in ROUTE_REQUIRE_PATTERN.finditer(_safe_string(index_file.get("content"))):
            variable_name = _safe_string(match.group(1))
            request_path = _safe_string(match.group(2))
            resolved_path = self._resolve_repo_module_path(
                importer_path=index_file["absolutePath"],
                request_path=request_path,
            )
            if variable_name and resolved_path:
                require_map[variable_name] = resolved_path

        mount_map: dict[str, str] = {}
        for match in APP_USE_PATTERN.finditer(_safe_string(index_file.get("content"))):
            prefix = _normalize_route_path(match.group(1))
            variable_name = _safe_string(match.group(2))
            route_file = require_map.get(variable_name)
            if route_file:
                mount_map[route_file] = prefix
        return mount_map

    def _extract_route_entries(self, *, content: str, prefix: str = "") -> list[dict[str, str]]:
        route_entries: list[dict[str, str]] = []
        for match in CHAINED_ROUTE_PATTERN.finditer(content):
            local_path = _normalize_route_path(match.group(1))
            chain_body = _safe_string(match.group(2))
            method_matches = list(ROUTE_METHOD_PATTERN.finditer(chain_body))
            if not method_matches:
                route_entries.append(
                    {
                        "method": "CHAIN",
                        "path": local_path,
                        "fullPath": _normalize_route_path(f"{prefix}/{local_path}"),
                    }
                )
                continue
            for method_match in method_matches:
                route_entries.append(
                    {
                        "method": _safe_string(method_match.group(1)).upper(),
                        "path": local_path,
                        "fullPath": _normalize_route_path(f"{prefix}/{local_path}"),
                    }
                )

        for match in DIRECT_ROUTE_PATTERN.finditer(content):
            route_entries.append(
                {
                    "method": _safe_string(match.group(1)).upper(),
                    "path": _normalize_route_path(match.group(2)),
                    "fullPath": _normalize_route_path(f"{prefix}/{match.group(2)}"),
                }
            )

        unique_entries: dict[str, dict[str, str]] = {}
        for entry in route_entries:
            key = f"{entry['method']}:{entry['fullPath']}"
            if key in unique_entries:
                continue
            full_path = entry["fullPath"]
            local_path = _normalize_route_path(full_path[len(prefix):] if prefix and full_path.startswith(prefix) else full_path)
            unique_entries[key] = {
                "method": entry["method"],
                "path": local_path,
                "fullPath": full_path,
            }
        return list(unique_entries.values())

    def _build_route_map(
        self,
        *,
        source_files: list[dict[str, Any]],
        dependency_index: dict[str, dict[str, list[str]]],
    ) -> list[dict[str, Any]]:
        mount_map = self._extract_mount_map(source_files)
        route_map: list[dict[str, Any]] = []
        for file_entry in source_files:
            file_path = _safe_string(file_entry.get("path"))
            if not file_path.startswith("server/routes/"):
                continue

            prefix = mount_map.get(file_path, "")
            route_entries = self._extract_route_entries(
                content=_safe_string(file_entry.get("content")),
                prefix=prefix,
            )
            dependencies = dependency_index.get(file_path, {"controllerRefs": [], "modelRefs": [], "serviceRefs": []})

            for entry in route_entries:
                controller_refs = list(dependencies.get("controllerRefs", []))
                service_refs = _unique(
                    [
                        ref
                        for controller_ref in controller_refs
                        for ref in (dependency_index.get(controller_ref, {}) or {}).get("serviceRefs", [])
                    ]
                )
                model_refs = _unique(
                    list(dependencies.get("modelRefs", []))
                    + [
                        ref
                        for controller_ref in controller_refs
                        for ref in (dependency_index.get(controller_ref, {}) or {}).get("modelRefs", [])
                    ]
                    + [
                        ref
                        for service_ref in service_refs
                        for ref in (dependency_index.get(service_ref, {}) or {}).get("modelRefs", [])
                    ]
                )
                route_map.append(
                    {
                        **entry,
                        "prefix": prefix,
                        "file": file_path,
                        "controllerRefs": controller_refs,
                        "serviceRefs": service_refs,
                        "modelRefs": model_refs,
                    }
                )
        return route_map

    def _extract_top_level_schema_fields(self, content: str) -> list[str]:
        lines = str(content or "").splitlines()
        fields: list[str] = []
        schema_started = False
        depth = 0
        for line in lines:
            if not schema_started and "mongoose.Schema({" in line:
                schema_started = True
                depth = 1
                continue
            if not schema_started:
                continue

            open_count = line.count("{")
            close_count = line.count("}")
            if depth == 1:
                field_match = TOP_LEVEL_FIELD_PATTERN.match(line)
                if field_match and field_match.group(1) not in fields:
                    fields.append(field_match.group(1))
            depth += open_count - close_count
            if depth <= 0:
                schema_started = False
        return fields

    def _build_model_map(self, source_files: list[dict[str, Any]]) -> list[dict[str, Any]]:
        model_map: list[dict[str, Any]] = []
        for file_entry in source_files:
            file_path = _safe_string(file_entry.get("path"))
            if not file_path.startswith("server/models/"):
                continue
            match = MODEL_NAME_PATTERN.search(_safe_string(file_entry.get("content")))
            if not match:
                continue
            model_map.append(
                {
                    "name": _safe_string(match.group(1)),
                    "file": file_path,
                    "fields": self._extract_top_level_schema_fields(_safe_string(file_entry.get("content"))),
                }
            )
        return model_map

    def _build_frontend_map(self, source_files: list[dict[str, Any]]) -> list[dict[str, Any]]:
        frontend_map: list[dict[str, Any]] = []
        for file_entry in source_files:
            file_path = _safe_string(file_entry.get("path"))
            if not file_path.startswith("app/src/"):
                continue
            import_requests = _extract_import_requests(_safe_string(file_entry.get("content")))
            imports = _unique(
                [
                    self._resolve_repo_module_path(
                        importer_path=file_entry["absolutePath"],
                        request_path=request_path,
                    )
                    for request_path in import_requests
                ]
            )
            imports = [entry for entry in imports if entry]
            route_guess = ""
            if "/pages/" in file_path:
                route_guess = _normalize_path(file_path.split("/pages/", 1)[1])
            frontend_map.append(
                {
                    "file": file_path,
                    "routeGuess": route_guess,
                    "apiEndpoints": _extract_api_endpoints(_safe_string(file_entry.get("content"))),
                    "imports": imports,
                }
            )
        return frontend_map

    def _build_workspace_intelligence(self) -> dict[str, Any]:
        source_files = self._collect_source_files()
        dependency_index = self._build_backend_dependency_index(source_files)
        route_map = self._build_route_map(source_files=source_files, dependency_index=dependency_index)
        model_map = self._build_model_map(source_files)
        frontend_map = self._build_frontend_map(source_files)
        return {
            "sourceFiles": source_files,
            "dependencyIndex": dependency_index,
            "routeMap": route_map,
            "modelMap": model_map,
            "frontendMap": frontend_map,
        }

    def _build_workspace_graph(self) -> dict[str, Any]:
        intelligence = self._build_workspace_intelligence()
        source_files = intelligence["sourceFiles"]
        dependency_index = intelligence["dependencyIndex"]
        route_map = intelligence["routeMap"]
        model_map = intelligence["modelMap"]
        frontend_map = intelligence["frontendMap"]

        nodes: list[dict[str, Any]] = []
        edges: list[dict[str, Any]] = []
        node_ids: set[str] = set()
        edge_keys: set[str] = set()

        def add_node(node: dict[str, Any]) -> None:
            node_id = _safe_string(node.get("id"))
            if not node_id or node_id in node_ids:
                return
            node_ids.add(node_id)
            nodes.append(node)

        def add_edge(edge: dict[str, Any]) -> None:
            from_id = _safe_string(edge.get("from"))
            to_id = _safe_string(edge.get("to"))
            edge_type = _safe_string(edge.get("type")) or "related"
            if not from_id or not to_id:
                return
            key = f"{from_id}:{to_id}:{edge_type}"
            if key in edge_keys:
                return
            edge_keys.add(key)
            edges.append({"from": from_id, "to": to_id, "type": edge_type})

        model_name_by_file = {
            _safe_string(model.get("file")): _safe_string(model.get("name"))
            for model in model_map
            if _safe_string(model.get("file")) and _safe_string(model.get("name"))
        }

        for file_entry in source_files:
            add_node(
                {
                    "id": f"file:{file_entry['path']}",
                    "type": "frontend_file" if file_entry["subsystem"] == "frontend" else "file",
                    "label": Path(file_entry["path"]).name,
                    "path": file_entry["path"],
                    "subsystem": file_entry["subsystem"],
                }
            )

        for model in model_map:
            add_node(
                {
                    "id": f"model:{model['name']}",
                    "type": "model",
                    "label": model["name"],
                    "path": model["file"],
                    "subsystem": "backend",
                }
            )
            add_edge({"from": f"file:{model['file']}", "to": f"model:{model['name']}", "type": "defines_model"})

        for route in route_map:
            route_id = f"route:{route['method']}:{route['fullPath']}"
            add_node(
                {
                    "id": route_id,
                    "type": "route",
                    "label": f"{route['method']} {route['fullPath']}",
                    "path": route["fullPath"],
                    "subsystem": "backend",
                }
            )
            add_edge({"from": f"file:{route['file']}", "to": route_id, "type": "declares_route"})
            for controller_ref in route.get("controllerRefs", []):
                add_edge({"from": route_id, "to": f"file:{controller_ref}", "type": "handled_by"})
            for service_ref in route.get("serviceRefs", []):
                add_edge({"from": route_id, "to": f"file:{service_ref}", "type": "invokes_service"})
            for model_ref in route.get("modelRefs", []):
                model_name = model_name_by_file.get(model_ref) or Path(model_ref).stem
                add_edge({"from": route_id, "to": f"model:{model_name}", "type": "touches_model"})

        for frontend_entry in frontend_map:
            file_node_id = f"file:{frontend_entry['file']}"
            for import_ref in frontend_entry.get("imports", []):
                add_edge({"from": file_node_id, "to": f"file:{import_ref}", "type": "imports"})
            for endpoint in frontend_entry.get("apiEndpoints", []):
                for route in route_map:
                    if (
                        route["fullPath"] == endpoint
                        or endpoint.startswith(_safe_string(route.get("prefix")))
                        or route["fullPath"].startswith(endpoint)
                    ):
                        add_edge(
                            {
                                "from": file_node_id,
                                "to": f"route:{route['method']}:{route['fullPath']}",
                                "type": "calls_api",
                            }
                        )

        for file_path, dependencies in dependency_index.items():
            for import_ref in dependencies.get("imports", []):
                add_edge({"from": f"file:{file_path}", "to": f"file:{import_ref}", "type": "imports"})
            for model_ref in dependencies.get("modelRefs", []):
                model_name = model_name_by_file.get(model_ref)
                if model_name:
                    add_edge({"from": f"file:{file_path}", "to": f"model:{model_name}", "type": "uses_model"})

        return {"nodes": nodes, "edges": edges, "routeMap": route_map, "modelMap": model_map}

    def _search_code_chunks_sync(
        self,
        query: str,
        limit: int,
        subsystem: str,
    ) -> list[dict[str, Any]]:
        terms = _tokenize(query)
        normalized_limit = max(1, min(int(limit or 6), 12))
        normalized_subsystem = _safe_string(subsystem)
        if not terms:
            return []

        matches: list[tuple[int, dict[str, Any]]] = []
        for file_entry in self._collect_source_files():
            if normalized_subsystem and _safe_string(file_entry.get("subsystem")) != normalized_subsystem:
                continue

            lines = str(file_entry.get("content") or "").splitlines()
            if not lines:
                continue

            for index in range(0, len(lines), DEFAULT_CHUNK_LINE_COUNT):
                start_line = index + 1
                end_line = min(len(lines), index + DEFAULT_CHUNK_LINE_COUNT)
                excerpt = "\n".join(lines[index:end_line])
                score_value = _score_text_against_terms(
                    text=excerpt,
                    path=file_entry.get("path"),
                    terms=terms,
                )
                if score_value <= 0:
                    continue
                matches.append(
                    (
                        score_value,
                        {
                            "id": f"workspace:{file_entry['path']}:{start_line}",
                            "label": f"{file_entry['path']}:{start_line}",
                            "type": "doc" if file_entry["subsystem"] == "docs" else "code",
                            "path": file_entry["path"],
                            "excerpt": excerpt,
                            "startLine": start_line,
                            "endLine": end_line,
                            "score": min(1.0, score_value / max(len(terms) * 5, 1)),
                            "metadata": {
                                "subsystem": file_entry["subsystem"],
                                "source": "workspace",
                            },
                        },
                    )
                )

        matches.sort(key=lambda entry: entry[0], reverse=True)
        return [entry[1] for entry in matches[:normalized_limit]]

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
        terms = _tokenize(query)
        normalized_limit = max(1, min(int(limit or 4), 8))
        if not terms:
            return []

        graph = self._build_workspace_graph()
        nodes = list(graph.get("nodes", []))
        edges = list(graph.get("edges", []))
        node_lookup = {
            _safe_string(node.get("id")): node
            for node in nodes
            if _safe_string(node.get("id"))
        }

        scored_nodes: list[tuple[int, dict[str, Any]]] = []
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
                edge
                for edge in edges
                if _safe_string(edge.get("from")) == _safe_string(node.get("id"))
                or _safe_string(edge.get("to")) == _safe_string(node.get("id"))
            ][:MAX_TRACE_STEPS]

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
                    "summary": (
                        f"Matched live workspace graph entity "
                        f"{_safe_string(node.get('label')) or _safe_string(node.get('path')) or _safe_string(node.get('id'))}"
                    ),
                    "steps": steps,
                    "score": score_value,
                }
            )
        return traces

    def _get_route_contract_sync(self, endpoint: str) -> list[dict[str, Any]]:
        normalized_endpoint = _normalize_path(endpoint).lower()
        if not normalized_endpoint:
            return []

        route_map = self._build_workspace_intelligence()["routeMap"]
        matches = []
        for route in route_map:
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
        normalized_model_name = _safe_string(model_name).lower()
        if not normalized_model_name:
            return []

        model_map = self._build_workspace_intelligence()["modelMap"]
        matches = []
        for model in model_map:
            candidate_name = _safe_string(model.get("name")).lower()
            if candidate_name == normalized_model_name or normalized_model_name in candidate_name:
                matches.append(model)
        return matches[:10]
