from __future__ import annotations

import json
import time
from typing import Any, Awaitable, Callable, Dict, List, Optional

from .config import settings
from .providers import GemmaProvider
from .schemas import AssistantReply, AssistantRequest, Citation, ToolRun, Verification
from .tool_gateway import NodeToolGateway

try:
    from langgraph.graph import END, START, StateGraph

    LANGGRAPH_AVAILABLE = True
except Exception:  # pragma: no cover - fallback for minimal environments
    END = "end"
    START = "start"
    StateGraph = None
    LANGGRAPH_AVAILABLE = False


EventCallback = Callable[[str, Dict[str, Any]], Awaitable[None] | None]
MAX_MULTIMODAL_IMAGES = 3
MAX_TOOL_PLAN_LENGTH = 8
RUNTIME_TOOLS = {
    "get_health_snapshot",
    "get_socket_health",
    "get_client_diagnostics",
}
APP_TOOLS = {
    "search_code_chunks",
    "get_file_section",
    "trace_system_path",
    "get_route_contract",
    "get_model_schema",
    "get_order_summary",
    "get_support_summary",
}
RUNTIME_PATTERN = (
    "diagnostic",
    "health",
    "runtime",
    "socket",
    "log",
    "failing",
    "error",
    "status",
)
APP_PATTERN = (
    "api",
    "app",
    "architecture",
    "backend",
    "code",
    "component",
    "controller",
    "database",
    "db",
    "file",
    "flow",
    "frontend",
    "model",
    "route",
    "schema",
    "service",
    "support video",
    "where is",
)


def _normalize_text(value: str) -> str:
    return str(value or "").strip()


def _normalize_int(value: Any, default: int, minimum: int, maximum: int) -> int:
    try:
        numeric_value = int(value)
    except (TypeError, ValueError):
        numeric_value = default
    return max(minimum, min(maximum, numeric_value))


def _build_image_blocks(images: List[Dict[str, Any]] | None = None) -> List[Dict[str, Any]]:
    blocks: List[Dict[str, Any]] = []
    for image in (images or [])[:MAX_MULTIMODAL_IMAGES]:
        if not isinstance(image, dict):
            continue
        url = _normalize_text(
            image.get("dataUrl")
            or image.get("url")
            or image.get("imageDataUrl")
            or image.get("imageUrl")
        )
        if not url:
            continue
        blocks.append(
            {
                "type": "image_url",
                "image_url": {
                    "url": url,
                },
            }
        )
    return blocks


def _build_multimodal_user_content(
    *,
    text: str,
    images: List[Dict[str, Any]] | None = None,
) -> str | List[Dict[str, Any]]:
    normalized_text = _normalize_text(text) or "Analyze the provided input."
    image_blocks = _build_image_blocks(images)
    if not image_blocks:
        return normalized_text
    return [
        {
            "type": "text",
            "text": normalized_text,
        },
        *image_blocks,
    ]


def _contains_any(message: str, patterns: tuple[str, ...]) -> bool:
    normalized = message.lower()
    return any(pattern in normalized for pattern in patterns)


def _make_follow_ups(mode: str) -> List[str]:
    if mode == "runtime_grounded":
        return [
            "Trace the failing path step by step",
            "Show the most relevant runtime evidence",
        ]
    if mode == "app_grounded":
        return [
            "Open the most relevant file path",
            "Trace the frontend-to-backend flow",
        ]
    return [
        "Ask a repo-grounded question",
        "Ask for a system trace with citations",
    ]


def _coerce_citation(
    *,
    citation_id: str,
    label: str,
    citation_type: str,
    path: str,
    excerpt: str = "",
    start_line: int = 0,
    end_line: int = 0,
    metadata: Optional[Dict[str, Any]] = None,
    score: float = 1.0,
) -> Dict[str, Any]:
    return {
        "id": citation_id,
        "label": label,
        "type": citation_type,
        "path": path,
        "excerpt": excerpt,
        "startLine": start_line,
        "endLine": end_line,
        "score": score,
        "metadata": metadata or {},
    }


def _extract_citations(tool_result: Dict[str, Any]) -> List[Dict[str, Any]]:
    result = tool_result.get("result", {})
    tool_run = tool_result.get("toolRun", {})
    tool_name = tool_run.get("toolName", "")

    if tool_name == "search_code_chunks":
        return result.get("results", [])

    if tool_name == "get_file_section" and result.get("section"):
        section = result["section"]
        return [
            _coerce_citation(
                citation_id=f"{section.get('path', '')}:{section.get('startLine', 0)}",
                label=f"{section.get('path', '')}:{section.get('startLine', 0)}",
                citation_type="code",
                path=section.get("path", ""),
                excerpt=section.get("content", ""),
                start_line=section.get("startLine", 0),
                end_line=section.get("endLine", 0),
                metadata={
                    "subsystem": section.get("subsystem", ""),
                },
            )
        ]

    if tool_name == "trace_system_path":
        citations: List[Dict[str, Any]] = []
        for trace in result.get("traces", [])[:4]:
            focus = trace.get("focus", {}) if isinstance(trace, dict) else {}
            label = _normalize_text(focus.get("label", ""))
            path = _normalize_text(focus.get("path", ""))
            if not label and not path:
                continue
            citations.append(
                _coerce_citation(
                    citation_id=_normalize_text(focus.get("id", "")) or f"trace:{label}:{path}",
                    label=label or path,
                    citation_type="graph",
                    path=path,
                    excerpt=_normalize_text(trace.get("summary", "")),
                    metadata={
                        "subsystem": focus.get("subsystem", ""),
                        "nodeType": focus.get("type", ""),
                    },
                    score=0.9,
                )
            )
        return citations

    if tool_name == "get_route_contract":
        citations = []
        for match in result.get("matches", [])[:4]:
            path = _normalize_text(match.get("file", ""))
            label = _normalize_text(match.get("fullPath", "")) or path
            if not label and not path:
                continue
            citations.append(
                _coerce_citation(
                    citation_id=f"route:{match.get('method', '')}:{label}",
                    label=f"{match.get('method', '').upper()} {label}".strip(),
                    citation_type="route",
                    path=path,
                    metadata={
                        "controllerRefs": match.get("controllerRefs", []),
                        "serviceRefs": match.get("serviceRefs", []),
                        "modelRefs": match.get("modelRefs", []),
                    },
                    score=0.88,
                )
            )
        return citations

    if tool_name == "get_model_schema":
        citations = []
        for match in result.get("matches", [])[:4]:
            path = _normalize_text(match.get("file", ""))
            label = _normalize_text(match.get("name", "")) or path
            if not label and not path:
                continue
            citations.append(
                _coerce_citation(
                    citation_id=f"model:{label}",
                    label=label,
                    citation_type="schema",
                    path=path,
                    excerpt=", ".join(match.get("fields", [])[:10]),
                    metadata={
                        "fields": match.get("fields", []),
                    },
                    score=0.88,
                )
            )
        return citations

    return []


def _tool_plan_key(plan: Dict[str, Any]) -> str:
    tool_name = _normalize_text(plan.get("toolName", ""))
    serialized_input = json.dumps(plan.get("input", {}), ensure_ascii=False, sort_keys=True)
    return f"{tool_name}:{serialized_input}"


def _normalize_planned_tool(tool_name: str, raw_input: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    normalized_tool_name = _normalize_text(tool_name)
    input_payload = raw_input if isinstance(raw_input, dict) else {}

    if normalized_tool_name == "search_code_chunks":
        query = _normalize_text(input_payload.get("query", ""))
        if not query:
            return None
        subsystem = _normalize_text(input_payload.get("subsystem", ""))
        return {
            "toolName": normalized_tool_name,
            "input": {
                "query": query,
                "limit": _normalize_int(input_payload.get("limit", 6), 6, 1, 12),
                "subsystem": subsystem,
            },
        }

    if normalized_tool_name == "get_file_section":
        path = _normalize_text(input_payload.get("path") or input_payload.get("targetPath") or "")
        if not path:
            return None
        return {
            "toolName": normalized_tool_name,
            "input": {
                "path": path,
                "startLine": _normalize_int(input_payload.get("startLine", 0), 0, 0, 100000),
                "endLine": _normalize_int(input_payload.get("endLine", 0), 0, 0, 100000),
                "aroundLine": _normalize_int(input_payload.get("aroundLine", 0), 0, 0, 100000),
                "radius": _normalize_int(input_payload.get("radius", 12), 12, 1, 60),
            },
        }

    if normalized_tool_name == "trace_system_path":
        query = _normalize_text(input_payload.get("query", ""))
        if not query:
            return None
        return {
            "toolName": normalized_tool_name,
            "input": {
                "query": query,
                "limit": _normalize_int(input_payload.get("limit", 4), 4, 1, 8),
            },
        }

    if normalized_tool_name == "get_route_contract":
        endpoint = _normalize_text(input_payload.get("endpoint", ""))
        if not endpoint:
            return None
        return {
            "toolName": normalized_tool_name,
            "input": {
                "endpoint": endpoint,
            },
        }

    if normalized_tool_name == "get_model_schema":
        model_name = _normalize_text(input_payload.get("modelName", ""))
        if not model_name:
            return None
        return {
            "toolName": normalized_tool_name,
            "input": {
                "modelName": model_name,
            },
        }

    if normalized_tool_name == "get_health_snapshot":
        return {
            "toolName": normalized_tool_name,
            "input": {},
        }

    if normalized_tool_name == "get_socket_health":
        return {
            "toolName": normalized_tool_name,
            "input": {},
        }

    if normalized_tool_name == "get_client_diagnostics":
        return {
            "toolName": normalized_tool_name,
            "input": {
                "sessionId": _normalize_text(input_payload.get("sessionId", "")),
                "requestId": _normalize_text(input_payload.get("requestId", "")),
                "route": _normalize_text(input_payload.get("route", "")),
                "type": _normalize_text(input_payload.get("type", "")),
                "severity": _normalize_text(input_payload.get("severity", "")),
                "limit": _normalize_int(input_payload.get("limit", 8), 8, 1, 20),
            },
        }

    if normalized_tool_name == "get_order_summary":
        return {
            "toolName": normalized_tool_name,
            "input": {
                "orderId": _normalize_text(input_payload.get("orderId", "")),
                "userId": _normalize_text(input_payload.get("userId", "")),
            },
        }

    if normalized_tool_name == "get_support_summary":
        return {
            "toolName": normalized_tool_name,
            "input": {
                "ticketId": _normalize_text(input_payload.get("ticketId", "")),
                "userId": _normalize_text(input_payload.get("userId", "")),
            },
        }

    return None


def _build_tool_definitions() -> List[Dict[str, Any]]:
    return [
        {
            "type": "function",
            "function": {
                "name": "search_code_chunks",
                "description": "Search the indexed Aura repo for relevant code or docs evidence.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "query": {"type": "string", "description": "The codebase query to search for."},
                        "limit": {"type": "integer", "description": "How many evidence matches to retrieve."},
                        "subsystem": {"type": "string", "description": "Optional subsystem like frontend, backend, docs, or infra."},
                    },
                    "required": ["query"],
                    "additionalProperties": False,
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "get_file_section",
                "description": "Load a concrete file section when the path is already known.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "path": {"type": "string", "description": "Repo-relative file path."},
                        "startLine": {"type": "integer"},
                        "endLine": {"type": "integer"},
                        "aroundLine": {"type": "integer"},
                        "radius": {"type": "integer"},
                    },
                    "required": ["path"],
                    "additionalProperties": False,
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "trace_system_path",
                "description": "Trace frontend-to-backend graph paths related to the question.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "query": {"type": "string"},
                        "limit": {"type": "integer"},
                    },
                    "required": ["query"],
                    "additionalProperties": False,
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "get_route_contract",
                "description": "Resolve a backend Express route and its controller, service, and model refs.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "endpoint": {"type": "string"},
                    },
                    "required": ["endpoint"],
                    "additionalProperties": False,
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "get_model_schema",
                "description": "Resolve a backend model schema and its fields.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "modelName": {"type": "string"},
                    },
                    "required": ["modelName"],
                    "additionalProperties": False,
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "get_health_snapshot",
                "description": "Fetch current backend and intelligence-layer runtime health.",
                "parameters": {
                    "type": "object",
                    "properties": {},
                    "additionalProperties": False,
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "get_socket_health",
                "description": "Fetch current realtime socket health.",
                "parameters": {
                    "type": "object",
                    "properties": {},
                    "additionalProperties": False,
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "get_client_diagnostics",
                "description": "Fetch client-side diagnostics, optionally scoped by session or route.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "sessionId": {"type": "string"},
                        "requestId": {"type": "string"},
                        "route": {"type": "string"},
                        "type": {"type": "string"},
                        "severity": {"type": "string"},
                        "limit": {"type": "integer"},
                    },
                    "additionalProperties": False,
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "get_order_summary",
                "description": "Fetch the actor-scoped order summary for the current user or a requested order id.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "orderId": {"type": "string"},
                        "userId": {"type": "string", "description": "Admin-only scope override."},
                    },
                    "additionalProperties": False,
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "get_support_summary",
                "description": "Fetch the actor-scoped support ticket summary for the current user or a requested ticket id.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "ticketId": {"type": "string"},
                        "userId": {"type": "string", "description": "Admin-only scope override."},
                    },
                    "additionalProperties": False,
                },
            },
        },
    ]


class AssistantOrchestrator:
    def __init__(self) -> None:
        self.gateway = NodeToolGateway()
        self.provider = GemmaProvider()
        self._graph = self._build_graph() if LANGGRAPH_AVAILABLE else None

    def _build_graph(self):
        graph = StateGraph(dict)
        graph.add_node("request_normalizer", self.request_normalizer)
        graph.add_node("intent_scope_classifier", self.intent_scope_classifier)
        graph.add_node("retrieval_planner", self.retrieval_planner)
        graph.add_node("graph_trace_resolver", self.graph_trace_resolver)
        graph.add_node("tool_runner", self.tool_runner)
        graph.add_node("evidence_validator", self.evidence_validator)
        graph.add_node("final_response_composer", self.final_response_composer)

        graph.add_edge(START, "request_normalizer")
        graph.add_edge("request_normalizer", "intent_scope_classifier")
        graph.add_edge("intent_scope_classifier", "retrieval_planner")
        graph.add_edge("retrieval_planner", "graph_trace_resolver")
        graph.add_edge("graph_trace_resolver", "tool_runner")
        graph.add_edge("tool_runner", "evidence_validator")
        graph.add_edge("evidence_validator", "final_response_composer")
        graph.add_edge("final_response_composer", END)
        return graph.compile()

    async def invoke(self, request: AssistantRequest, event_callback: EventCallback | None = None) -> AssistantReply:
        initial_state: Dict[str, Any] = {
            "request": request,
            "trace_id": request.traceId,
            "started_at": time.perf_counter(),
            "message": "",
            "answer_mode": "app_grounded",
            "tool_plan": [],
            "tool_results": [],
            "citations": [],
            "tool_runs": [],
            "verification": {
                "label": "cannot_verify",
                "confidence": 0.0,
                "summary": "",
                "evidenceCount": 0,
            },
            "answer": "",
            "follow_ups": [],
            "event_callback": event_callback,
            "stream_response": callable(event_callback),
            "routing_model": self._resolve_routing_model(request),
            "reasoning_model": self._resolve_reasoning_model(request),
            "guard_reason": "",
            "stale_bundle": False,
            "missing_evidence": False,
        }

        if self._graph is not None:
            state = await self._graph.ainvoke(initial_state)
        else:  # pragma: no cover - executed only when langgraph is unavailable
            state = initial_state
            for step in (
                self.request_normalizer,
                self.intent_scope_classifier,
                self.retrieval_planner,
                self.graph_trace_resolver,
                self.tool_runner,
                self.evidence_validator,
                self.final_response_composer,
            ):
                state = await step(state)

        latency_ms = int((time.perf_counter() - state["started_at"]) * 1000)
        verification = Verification(**state["verification"])
        citations = [Citation(**citation) for citation in state["citations"][:10]]
        tool_runs = [ToolRun(**tool_run) for tool_run in state["tool_runs"][:10]]
        answer = _normalize_text(state["answer"]) or "I could not compose a verified answer."
        answer_mode = state["answer_mode"]
        reasoning_model = _normalize_text(state.get("reasoning_model", "")) or settings.reasoning_model

        return AssistantReply(
            answer=answer,
            citations=citations,
            toolRuns=tool_runs,
            verification=verification,
            grounding={
                "mode": answer_mode,
                "status": "cannot_verify" if verification.label == "cannot_verify" else "verified",
                "reason": _normalize_text(state.get("guard_reason", "")),
                "staleBundle": bool(state.get("stale_bundle", False)),
                "missingEvidence": bool(state.get("missing_evidence", False)),
                "evidenceCount": verification.evidenceCount,
                "bundleVersion": request.bundleVersion,
                "traceId": request.traceId,
                "sources": [
                    {
                        "label": citation.label,
                        "path": citation.path,
                        "type": citation.type,
                    }
                    for citation in citations
                ],
            },
            followUps=state["follow_ups"],
            assistantTurn={
                "intent": "general_knowledge",
                "confidence": verification.confidence,
                "decision": "respond",
                "response": answer,
                "ui": {
                    "surface": "plain_answer",
                },
                "followUps": state["follow_ups"],
                "citations": [citation.model_dump() for citation in citations],
                "toolRuns": [tool_run.model_dump() for tool_run in tool_runs],
                "verification": verification.model_dump(),
                "answerMode": answer_mode,
            },
            provider={
                "name": "gemma-central-intelligence",
                "model": reasoning_model,
            },
            latencyMs=latency_ms,
        )

    async def request_normalizer(self, state: Dict[str, Any]) -> Dict[str, Any]:
        request: AssistantRequest = state["request"]
        state["message"] = _normalize_text(request.request.message)
        state["follow_ups"] = _make_follow_ups("app_grounded")
        return state

    async def intent_scope_classifier(self, state: Dict[str, Any]) -> Dict[str, Any]:
        message = state["message"]
        request: AssistantRequest = state["request"]

        if _contains_any(message, RUNTIME_PATTERN):
            state["answer_mode"] = "runtime_grounded"
        elif _contains_any(message, APP_PATTERN) or request.runtimeContext.route:
            state["answer_mode"] = "app_grounded"
        else:
            state["answer_mode"] = "model_knowledge"

        state["follow_ups"] = _make_follow_ups(state["answer_mode"])
        return state

    async def retrieval_planner(self, state: Dict[str, Any]) -> Dict[str, Any]:
        request: AssistantRequest = state["request"]
        initial_mode = state["answer_mode"]
        message = state["message"]

        gemma_plan = await self._plan_tools_with_gemma(
            request=request,
            message=message,
            answer_mode=initial_mode,
        )
        fallback_plan = self._build_fallback_tool_plan(
            message=message,
            request=request,
            answer_mode=initial_mode,
        )

        merged_plan = self._merge_tool_plans(gemma_plan, fallback_plan)
        if merged_plan:
            state["tool_plan"] = merged_plan
            if any(entry["toolName"] in RUNTIME_TOOLS for entry in merged_plan):
                state["answer_mode"] = "runtime_grounded"
            elif any(entry["toolName"] in APP_TOOLS for entry in merged_plan):
                state["answer_mode"] = "app_grounded"
        else:
            state["tool_plan"] = []

        state["follow_ups"] = _make_follow_ups(state["answer_mode"])
        return state

    async def graph_trace_resolver(self, state: Dict[str, Any]) -> Dict[str, Any]:
        if state["answer_mode"] in {"app_grounded", "runtime_grounded"}:
            state["tool_plan"] = self._merge_tool_plans(
                state.get("tool_plan", []),
                [
                    {
                        "toolName": "trace_system_path",
                        "input": {
                            "query": state["message"],
                            "limit": 4,
                        },
                    }
                ],
            )
        return state

    async def tool_runner(self, state: Dict[str, Any]) -> Dict[str, Any]:
        request: AssistantRequest = state["request"]
        tool_results: List[Dict[str, Any]] = []
        citations: List[Dict[str, Any]] = []
        tool_runs: List[Dict[str, Any]] = []
        callback = state.get("event_callback")
        auth_context = {
            "actorUserId": request.userContext.id,
            "isAdmin": request.userContext.isAdmin,
        }

        for planned_tool in state["tool_plan"]:
            tool_name = planned_tool["toolName"]
            await self._emit_event(
                callback,
                "tool_start",
                {
                    "toolName": tool_name,
                    "status": "running",
                    "input": planned_tool.get("input", {}),
                },
            )

            result = await self.gateway.run_tool(
                tool_name,
                input_payload=planned_tool.get("input", {}),
                auth_context=auth_context,
            )
            tool_results.append(result)
            tool_runs.append(result.get("toolRun", {}))
            citations.extend(_extract_citations(result))

            await self._emit_event(callback, "tool_end", result.get("toolRun", {}))

        state["tool_results"] = tool_results
        state["tool_runs"] = tool_runs
        state["citations"] = citations
        return state

    async def evidence_validator(self, state: Dict[str, Any]) -> Dict[str, Any]:
        request: AssistantRequest = state["request"]
        answer_mode = state["answer_mode"]
        citations = state["citations"]
        tool_results = state["tool_results"]

        if request.expectedBundleVersion and request.bundleVersion and request.expectedBundleVersion != request.bundleVersion:
            state["guard_reason"] = "stale_bundle"
            state["stale_bundle"] = True
            state["missing_evidence"] = False
            state["verification"] = {
                "label": "cannot_verify",
                "confidence": 0.0,
                "summary": "The active knowledge bundle does not match the deployed app version.",
                "evidenceCount": 0,
            }
            state["answer"] = (
                "I cannot verify app-specific details because the active knowledge bundle does not "
                "match the deployed app version."
            )
            return state

        if answer_mode == "app_grounded" and not citations:
            state["guard_reason"] = "missing_repo_evidence"
            state["stale_bundle"] = False
            state["missing_evidence"] = True
            state["verification"] = {
                "label": "cannot_verify",
                "confidence": 0.0,
                "summary": "No repo-grounded evidence was returned by the tool layer.",
                "evidenceCount": 0,
            }
            state["answer"] = "I cannot verify that from the current system state."
            return state

        if answer_mode == "runtime_grounded" and not citations and not tool_results:
            state["guard_reason"] = "missing_runtime_evidence"
            state["stale_bundle"] = False
            state["missing_evidence"] = True
            state["verification"] = {
                "label": "cannot_verify",
                "confidence": 0.0,
                "summary": "No runtime evidence was returned by the tool layer.",
                "evidenceCount": 0,
            }
            state["answer"] = "I cannot verify that from the current runtime state."
            return state

        evidence_count = len(citations) if citations else len(tool_results)
        state["guard_reason"] = ""
        state["stale_bundle"] = False
        state["missing_evidence"] = False
        state["verification"] = {
            "label": answer_mode if answer_mode in {"app_grounded", "runtime_grounded", "model_knowledge"} else "cannot_verify",
            "confidence": 0.92 if citations else 0.78 if tool_results else 0.6,
            "summary": (
                "Verified against indexed app evidence."
                if answer_mode == "app_grounded"
                else "Verified against runtime and app evidence."
                if answer_mode == "runtime_grounded"
                else "This answer comes from the model, not repo-grounded evidence."
            ),
            "evidenceCount": evidence_count,
        }
        return state

    async def final_response_composer(self, state: Dict[str, Any]) -> Dict[str, Any]:
        if state["answer"]:
            return state

        answer_mode = state["answer_mode"]
        message = state["message"]
        citations = state["citations"]
        tool_results = state["tool_results"]
        images = state["request"].request.images
        callback = state.get("event_callback")

        if answer_mode == "model_knowledge":
            state["answer"] = await self._compose_model_knowledge(
                message,
                images=images,
                event_callback=callback,
                reasoning_model=state["reasoning_model"],
            )
            return state

        state["answer"] = await self._compose_grounded_answer(
            message=message,
            answer_mode=answer_mode,
            citations=citations,
            tool_results=tool_results,
            images=images,
            event_callback=callback,
            reasoning_model=state["reasoning_model"],
        )
        return state

    async def _compose_model_knowledge(
        self,
        message: str,
        *,
        images: List[Dict[str, Any]] | None = None,
        event_callback: EventCallback | None = None,
        reasoning_model: str,
    ) -> str:
        system_prompt = (
            "You are Aura's Gemma 4 model-knowledge mode. "
            "Answer the user's question clearly, and explicitly state that the answer is not repo-grounded. "
            "If images are provided, use them as part of the answer."
        )
        generated = await self.provider.generate_text(
            messages=[
                {"role": "system", "content": system_prompt},
                {
                    "role": "user",
                    "content": _build_multimodal_user_content(
                        text=message,
                        images=images,
                    ),
                },
            ],
            model=reasoning_model,
            endpoint_url=self._resolve_reasoning_endpoint(),
            temperature=0.2,
            on_token=self._build_token_emitter(event_callback),
        )
        if generated:
            return generated
        return (
            "This question is outside the indexed app scope, and no connected Gemma endpoint is configured in "
            "this environment, so I cannot provide a trustworthy beyond-scope answer yet."
        )

    async def _compose_grounded_answer(
        self,
        *,
        message: str,
        answer_mode: str,
        citations: List[Dict[str, Any]],
        tool_results: List[Dict[str, Any]],
        images: List[Dict[str, Any]] | None = None,
        event_callback: EventCallback | None = None,
        reasoning_model: str,
    ) -> str:
        compact_evidence = {
            "citations": citations[:4],
            "toolResults": [result.get("result", {}) for result in tool_results[:4]],
        }
        system_prompt = (
            "You are Aura's grounded Gemma 4 reasoning layer. "
            "Use only the provided evidence. If evidence is weak, explicitly say you cannot verify. "
            "If images are provided, use them only as supplemental evidence for the user's question."
        )
        generated = await self.provider.generate_text(
            messages=[
                {"role": "system", "content": system_prompt},
                {
                    "role": "user",
                    "content": _build_multimodal_user_content(
                        text=(
                            f"Question: {message}\n"
                            f"Mode: {answer_mode}\n"
                            f"Evidence JSON:\n{json.dumps(compact_evidence, ensure_ascii=False)}"
                        ),
                        images=images,
                    ),
                },
            ],
            model=reasoning_model,
            endpoint_url=self._resolve_reasoning_endpoint(),
            on_token=self._build_token_emitter(event_callback),
        )
        if generated:
            return generated

        first_citation = citations[0] if citations else {}
        first_label = first_citation.get("label") or first_citation.get("path") or "the indexed codebase"
        if answer_mode == "runtime_grounded":
            return f"I verified this against runtime evidence and the indexed app graph. The strongest evidence currently points to {first_label}."
        return f"I verified this against the indexed app bundle. The strongest evidence currently points to {first_label}."

    def _resolve_reasoning_model(self, request: AssistantRequest) -> str:
        model = _normalize_text(request.providerConfig.get("reasoningModel", ""))
        return model or settings.reasoning_model

    def _resolve_routing_model(self, request: AssistantRequest) -> str:
        model = _normalize_text(request.providerConfig.get("routingModel", ""))
        return model or settings.routing_model

    def _resolve_reasoning_endpoint(self) -> str:
        return settings.reasoning_endpoint_url or settings.routing_endpoint_url

    def _resolve_routing_endpoint(self) -> str:
        return settings.routing_endpoint_url or settings.reasoning_endpoint_url

    def _build_fallback_tool_plan(
        self,
        *,
        message: str,
        request: AssistantRequest,
        answer_mode: str,
    ) -> List[Dict[str, Any]]:
        tool_plan: List[Dict[str, Any]] = []

        if answer_mode in {"app_grounded", "runtime_grounded"}:
            tool_plan.append(
                {
                    "toolName": "search_code_chunks",
                    "input": {"query": message, "limit": 6},
                }
            )
            if "/" in message or "route" in message.lower() or "api" in message.lower():
                tool_plan.append(
                    {
                        "toolName": "get_route_contract",
                        "input": {"endpoint": message},
                    }
                )
            if "schema" in message.lower() or "model" in message.lower() or "db" in message.lower():
                tool_plan.append(
                    {
                        "toolName": "get_model_schema",
                        "input": {"modelName": message},
                    }
                )

        if answer_mode == "runtime_grounded":
            tool_plan.extend(
                [
                    {"toolName": "get_health_snapshot", "input": {}},
                    {"toolName": "get_socket_health", "input": {}},
                ]
            )
            if request.runtimeContext.sessionId:
                tool_plan.append(
                    {
                        "toolName": "get_client_diagnostics",
                        "input": {
                            "sessionId": request.runtimeContext.sessionId,
                            "limit": 8,
                        },
                    }
                )

        if "order" in message.lower():
            tool_plan.append({"toolName": "get_order_summary", "input": {}})
        if "support" in message.lower():
            tool_plan.append({"toolName": "get_support_summary", "input": {}})

        return self._merge_tool_plans(tool_plan)

    async def _plan_tools_with_gemma(
        self,
        *,
        request: AssistantRequest,
        message: str,
        answer_mode: str,
    ) -> List[Dict[str, Any]]:
        routing_model = self._resolve_routing_model(request)
        if not routing_model:
            return []

        planner_prompt = (
            "You are Aura's routing and tool-planning layer. "
            "Call the smallest set of tools needed to answer questions about the Aura app, runtime, repo, "
            "routes, models, logs, sockets, orders, or support. "
            "If the question is general knowledge outside the app and does not need repo or runtime evidence, call no tools. "
            "Prefer search_code_chunks for grounded app questions so downstream answers can cite real repo evidence."
        )
        planner_input = {
            "question": message,
            "initialModeHint": answer_mode,
            "route": request.runtimeContext.route,
            "routeLabel": request.runtimeContext.routeLabel,
            "sessionId": request.runtimeContext.sessionId,
            "currentProductId": request.runtimeContext.currentProductId,
            "conversationHistory": [
                entry.model_dump() if hasattr(entry, "model_dump") else entry
                for entry in request.request.conversationHistory[-4:]
            ],
            "actor": {
                "isAuthenticated": request.userContext.isAuthenticated,
                "isAdmin": request.userContext.isAdmin,
            },
        }

        try:
            raw_tool_calls = await self.provider.plan_tool_calls(
                messages=[
                    {"role": "system", "content": planner_prompt},
                    {"role": "user", "content": json.dumps(planner_input, ensure_ascii=False)},
                ],
                model=routing_model,
                endpoint_url=self._resolve_routing_endpoint(),
                tools=_build_tool_definitions(),
            )
        except Exception:
            return []

        normalized_plan: List[Dict[str, Any]] = []
        for raw_tool_call in raw_tool_calls:
            function = raw_tool_call.get("function", {}) if isinstance(raw_tool_call, dict) else {}
            tool_name = _normalize_text(function.get("name", ""))
            tool_input = function.get("arguments", {})
            planned_tool = _normalize_planned_tool(tool_name, tool_input)
            if planned_tool:
                normalized_plan.append(planned_tool)

        return self._merge_tool_plans(normalized_plan)

    def _merge_tool_plans(self, *plans: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        merged_plan: List[Dict[str, Any]] = []
        seen = set()
        for plan_group in plans:
            for plan in plan_group or []:
                normalized_tool_name = _normalize_text(plan.get("toolName", ""))
                if not normalized_tool_name:
                    continue
                key = _tool_plan_key(plan)
                if key in seen:
                    continue
                seen.add(key)
                merged_plan.append(
                    {
                        "toolName": normalized_tool_name,
                        "input": plan.get("input", {}) if isinstance(plan.get("input", {}), dict) else {},
                    }
                )
                if len(merged_plan) >= MAX_TOOL_PLAN_LENGTH:
                    return merged_plan
        return merged_plan

    async def _emit_event(
        self,
        callback: EventCallback | None,
        event_name: str,
        data: Dict[str, Any],
    ) -> None:
        if not callable(callback):
            return
        maybe_awaitable = callback(event_name, data)
        if maybe_awaitable is not None:
            await maybe_awaitable

    def _build_token_emitter(self, callback: EventCallback | None) -> Callable[[str], Awaitable[None] | None] | None:
        if not callable(callback):
            return None

        async def emit_token(token_text: str) -> None:
            await self._emit_event(callback, "token", {"text": token_text})

        return emit_token

    async def close(self) -> None:
        await self.gateway.close()
        await self.provider.close()
