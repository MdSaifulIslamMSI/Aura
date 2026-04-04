from __future__ import annotations

import asyncio
import contextlib
import json
from typing import Any, AsyncIterator

from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.responses import StreamingResponse

from .config import settings
from .index_state import read_active_index
from .orchestrator import AssistantOrchestrator
from .schemas import AssistantRequest

app = FastAPI(title="Aura Gemma 4 Intelligence Service", version="1.0.0")
orchestrator = AssistantOrchestrator()


def _verify_service_auth(authorization: str = Header(default="")) -> None:
    if settings.service_token and authorization.strip() != f"Bearer {settings.service_token}":
        raise HTTPException(status_code=401, detail="Unauthorized intelligence request")


def _to_sse(event: str, data: dict[str, Any]) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


@app.get("/health")
async def health() -> dict[str, Any]:
    return {
        "status": "ok",
        "service": "gemma4-central-intelligence",
        "models": {
            "routing": settings.routing_model,
            "reasoning": settings.reasoning_model,
        },
        "stores": {
            "qdrantConfigured": bool(settings.qdrant_url),
            "neo4jConfigured": bool(settings.neo4j_url),
        },
        "activeIndex": read_active_index(),
    }


@app.post("/v1/assistant/reply", dependencies=[Depends(_verify_service_auth)])
async def assistant_reply(payload: AssistantRequest) -> dict[str, Any]:
    reply = await orchestrator.invoke(payload)
    return reply.model_dump()


@app.post("/v1/assistant/reply/stream", dependencies=[Depends(_verify_service_auth)])
async def assistant_reply_stream(payload: AssistantRequest) -> StreamingResponse:
    async def event_stream() -> AsyncIterator[str]:
        queue: asyncio.Queue[tuple[str, dict[str, Any]]] = asyncio.Queue()
        terminal_event = "__final__"
        error_event = "__error__"

        async def emit(event_name: str, data: dict[str, Any]) -> None:
            await queue.put((event_name, data))

        async def run_orchestrator() -> None:
            try:
                reply = await orchestrator.invoke(payload, event_callback=emit)
                await queue.put((terminal_event, reply.model_dump()))
            except Exception as exc:  # pragma: no cover - exercised in integration
                await queue.put((error_event, {"message": str(exc)}))

        task = asyncio.create_task(run_orchestrator())

        try:
            while True:
                event_name, data = await queue.get()
                if event_name == terminal_event:
                    verification = data.get("verification", {}) if isinstance(data, dict) else {}
                    citations = data.get("citations", []) if isinstance(data, dict) else []
                    yield _to_sse("verification", verification)
                    for citation in citations:
                        if isinstance(citation, dict):
                            yield _to_sse("citation", citation)
                    yield _to_sse("final_turn", data if isinstance(data, dict) else {})
                    break
                if event_name == error_event:
                    yield _to_sse("error", data if isinstance(data, dict) else {"message": "Streaming failed"})
                    break
                yield _to_sse(event_name, data)
        finally:
            if not task.done():
                task.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await task

    return StreamingResponse(event_stream(), media_type="text/event-stream")


@app.on_event("shutdown")
async def shutdown_event() -> None:
    await orchestrator.close()
