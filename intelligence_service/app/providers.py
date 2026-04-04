from __future__ import annotations

import asyncio
import json
import threading
from typing import Any, Awaitable, Callable, Dict, List, Optional
from urllib.parse import urlparse

from huggingface_hub import InferenceClient

from .config import settings


TokenCallback = Callable[[str], Awaitable[None] | None]


def _looks_like_url(value: str) -> bool:
    parsed = urlparse(str(value or "").strip())
    return parsed.scheme in {"http", "https"}


def _coerce_text_content(content: Any) -> Optional[str]:
    if isinstance(content, list):
        text_parts = [
            part.get("text", "") if isinstance(part, dict) else str(part)
            for part in content
        ]
        normalized = "\n".join(text_parts).strip()
        return normalized or None

    normalized = str(content or "").strip()
    return normalized or None


def _parse_tool_arguments(raw_arguments: Any) -> Optional[Dict[str, Any]]:
    if raw_arguments is None:
        return {}
    if isinstance(raw_arguments, dict):
        return raw_arguments
    if not isinstance(raw_arguments, str):
        return None

    normalized = raw_arguments.strip()
    if not normalized:
        return {}

    try:
        parsed = json.loads(normalized)
    except json.JSONDecodeError:
        return None

    return parsed if isinstance(parsed, dict) else None


def _normalize_tool_calls(raw_tool_calls: Any) -> List[Dict[str, Any]]:
    normalized_calls: List[Dict[str, Any]] = []
    for raw_tool_call in raw_tool_calls or []:
        function = getattr(raw_tool_call, "function", None)
        if function is None and isinstance(raw_tool_call, dict):
            function = raw_tool_call.get("function")

        name = ""
        arguments: Any = {}
        tool_call_id = ""

        if isinstance(function, dict):
            name = str(function.get("name", "") or "").strip()
            arguments = function.get("arguments", {})
        else:
            name = str(getattr(function, "name", "") or "").strip()
            arguments = getattr(function, "arguments", {})

        if isinstance(raw_tool_call, dict):
            tool_call_id = str(raw_tool_call.get("id", "") or "").strip()
        else:
            tool_call_id = str(getattr(raw_tool_call, "id", "") or "").strip()

        parsed_arguments = _parse_tool_arguments(arguments)
        if not name or parsed_arguments is None:
            continue

        normalized_calls.append(
            {
                "id": tool_call_id,
                "type": "function",
                "function": {
                    "name": name,
                    "arguments": parsed_arguments,
                },
            }
        )

    return normalized_calls


def _extract_stream_delta_content(chunk: Any) -> str:
    choices = getattr(chunk, "choices", None) or []
    if not choices:
        return ""

    delta = getattr(choices[0], "delta", None)
    if delta is None:
        return ""

    content = getattr(delta, "content", "")
    if isinstance(content, list):
        return "".join(
            part.get("text", "") if isinstance(part, dict) else str(part)
            for part in content
        )
    return str(content or "")


class GemmaProvider:
    def __init__(self) -> None:
        pass

    def _timeout_seconds(self) -> float:
        timeout_ms = max(5000, int(settings.provider_timeout_ms or 25000))
        return timeout_ms / 1000.0

    async def close(self) -> None:
        return None

    async def generate_text(
        self,
        *,
        messages: List[Dict[str, Any]],
        model: str,
        endpoint_url: str,
        temperature: float = 0.1,
        on_token: TokenCallback | None = None,
    ) -> Optional[str]:
        if not model:
            return None

        if on_token is None:
            try:
                return await asyncio.wait_for(
                    asyncio.to_thread(
                        self._generate_text_sync,
                        messages,
                        model,
                        endpoint_url,
                        temperature,
                    ),
                    timeout=self._timeout_seconds(),
                )
            except Exception:
                return None

        try:
            return await asyncio.wait_for(
                self._stream_text_async(
                    messages=messages,
                    model=model,
                    endpoint_url=endpoint_url,
                    temperature=temperature,
                    on_token=on_token,
                ),
                timeout=self._timeout_seconds(),
            )
        except Exception:
            return None

    async def plan_tool_calls(
        self,
        *,
        messages: List[Dict[str, Any]],
        model: str,
        endpoint_url: str,
        tools: List[Dict[str, Any]],
        tool_choice: str = "auto",
        temperature: float = 0.0,
    ) -> List[Dict[str, Any]]:
        if not model or not tools:
            return []

        try:
            return await asyncio.wait_for(
                asyncio.to_thread(
                    self._plan_tool_calls_sync,
                    messages,
                    model,
                    endpoint_url,
                    tools,
                    tool_choice,
                    temperature,
                ),
                timeout=self._timeout_seconds(),
            )
        except Exception:
            return []

    def _create_client(self, endpoint_url: str) -> InferenceClient:
        client_kwargs: Dict[str, str] = {}
        if settings.endpoint_api_key:
            client_kwargs["api_key"] = settings.endpoint_api_key
        if _looks_like_url(endpoint_url):
            client_kwargs["base_url"] = endpoint_url

        return InferenceClient(**client_kwargs)

    def _generate_text_sync(
        self,
        messages: List[Dict[str, Any]],
        model: str,
        endpoint_url: str,
        temperature: float,
    ) -> Optional[str]:
        client = self._create_client(endpoint_url)
        response = client.chat.completions.create(
            model=model,
            messages=messages,
            temperature=temperature,
            stream=False,
        )
        choices = getattr(response, "choices", None) or []
        if not choices:
            return None

        message = getattr(choices[0], "message", None)
        return _coerce_text_content(getattr(message, "content", ""))

    def _plan_tool_calls_sync(
        self,
        messages: List[Dict[str, Any]],
        model: str,
        endpoint_url: str,
        tools: List[Dict[str, Any]],
        tool_choice: str,
        temperature: float,
    ) -> List[Dict[str, Any]]:
        client = self._create_client(endpoint_url)
        response = client.chat.completions.create(
            model=model,
            messages=messages,
            temperature=temperature,
            tools=tools,
            tool_choice=tool_choice,
            stream=False,
        )
        choices = getattr(response, "choices", None) or []
        if not choices:
            return []

        message = getattr(choices[0], "message", None)
        raw_tool_calls = getattr(message, "tool_calls", None)
        return _normalize_tool_calls(raw_tool_calls)

    async def _stream_text_async(
        self,
        *,
        messages: List[Dict[str, Any]],
        model: str,
        endpoint_url: str,
        temperature: float,
        on_token: TokenCallback,
    ) -> Optional[str]:
        loop = asyncio.get_running_loop()
        queue: asyncio.Queue[tuple[str, Any]] = asyncio.Queue()

        def worker() -> None:
            try:
                client = self._create_client(endpoint_url)
                stream = client.chat.completions.create(
                    model=model,
                    messages=messages,
                    temperature=temperature,
                    stream=True,
                )
                for chunk in stream:
                    token_text = _extract_stream_delta_content(chunk)
                    if token_text:
                        loop.call_soon_threadsafe(queue.put_nowait, ("token", token_text))
            except Exception as error:  # pragma: no cover - exercised in integration
                loop.call_soon_threadsafe(queue.put_nowait, ("error", error))
            finally:
                loop.call_soon_threadsafe(queue.put_nowait, ("done", None))

        threading.Thread(target=worker, daemon=True).start()

        chunks: List[str] = []
        while True:
            event_name, payload = await queue.get()
            if event_name == "token":
                chunks.append(str(payload))
                maybe_awaitable = on_token(str(payload))
                if maybe_awaitable is not None:
                    await maybe_awaitable
                continue
            if event_name == "error":
                raise payload
            if event_name == "done":
                break

        normalized = "".join(chunks).strip()
        return normalized or None
