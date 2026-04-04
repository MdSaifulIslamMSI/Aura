from __future__ import annotations

import asyncio
import base64
import json
import mimetypes
import re
import threading
import uuid
from typing import Any, Awaitable, Callable, Dict, Iterable, List, Optional
from urllib.parse import urlparse

import httpx
from huggingface_hub import InferenceClient

from .config import settings


TokenCallback = Callable[[str], Awaitable[None] | None]

DATA_URL_PATTERN = re.compile(
    r"^data:(?P<mime>[-\w.+/]+);base64,(?P<data>[A-Za-z0-9+/=\s]+)$",
    re.IGNORECASE,
)
JSON_ARRAY_PATTERN = re.compile(r"\[[\s\S]*\]")
JSON_OBJECT_PATTERN = re.compile(r"\{[\s\S]*\}")


def _safe_text(value: Any) -> str:
    return str(value or "").strip()


def _looks_like_url(value: str) -> bool:
    parsed = urlparse(str(value or "").strip())
    return parsed.scheme in {"http", "https"}


def _looks_like_google_api_url(value: str) -> bool:
    normalized = _safe_text(value).lower()
    return "generativelanguage.googleapis.com" in normalized


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


def _iter_content_parts(content: Any) -> Iterable[Dict[str, str]]:
    if isinstance(content, list):
        for part in content:
            if isinstance(part, dict):
                part_type = _safe_text(part.get("type", "")).lower()
                if part_type == "text":
                    text = _safe_text(part.get("text", ""))
                    if text:
                        yield {"type": "text", "text": text}
                elif part_type == "image_url":
                    image_url = _safe_text((part.get("image_url") or {}).get("url", ""))
                    if image_url:
                        yield {"type": "image", "url": image_url}
                else:
                    text = _safe_text(part.get("text", ""))
                    if text:
                        yield {"type": "text", "text": text}
            else:
                text = _safe_text(part)
                if text:
                    yield {"type": "text", "text": text}
        return

    text = _safe_text(content)
    if text:
        yield {"type": "text", "text": text}


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
            name = _safe_text(function.get("name", ""))
            arguments = function.get("arguments", {})
        else:
            name = _safe_text(getattr(function, "name", ""))
            arguments = getattr(function, "arguments", {})

        if isinstance(raw_tool_call, dict):
            tool_call_id = _safe_text(raw_tool_call.get("id", ""))
        else:
            tool_call_id = _safe_text(getattr(raw_tool_call, "id", ""))

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


def _normalize_google_gemma_model_name(model: str) -> str:
    normalized = _safe_text(model).lower()
    if normalized.startswith("google/"):
        normalized = normalized.split("/", 1)[1]
    if ":" in normalized:
        normalized = normalized.split(":", 1)[0]
    return normalized


def _is_google_gemma_model(model: str) -> bool:
    normalized = _normalize_google_gemma_model_name(model)
    return normalized.startswith("gemma-")


def _supports_hosted_gemma_thinking(model: str) -> bool:
    normalized = _normalize_google_gemma_model_name(model)
    if normalized.startswith("gemma-4-"):
        return True
    if normalized.startswith("gemma-3-"):
        return False
    return not _is_google_gemma_model(model)


def _resolve_thinking_level() -> str:
    normalized = _safe_text(settings.gemma_thinking_level).lower()
    if normalized == "low":
        return "LOW"
    return "HIGH"


def _extract_json_payload(raw_text: str) -> Any:
    normalized = _safe_text(raw_text)
    if not normalized:
        return []

    for candidate in (normalized,):
        try:
            return json.loads(candidate)
        except json.JSONDecodeError:
            pass

    for pattern in (JSON_ARRAY_PATTERN, JSON_OBJECT_PATTERN):
        match = pattern.search(normalized)
        if not match:
            continue
        try:
            return json.loads(match.group(0))
        except json.JSONDecodeError:
            continue

    return []


def _normalize_prompt_tool_calls(raw_payload: Any) -> List[Dict[str, Any]]:
    if isinstance(raw_payload, dict):
        if isinstance(raw_payload.get("calls"), list):
            return _normalize_prompt_tool_calls(raw_payload.get("calls"))

        name = _safe_text(raw_payload.get("name", ""))
        parameters = raw_payload.get("parameters", {})
        if name and isinstance(parameters, dict):
            return [
                {
                    "id": f"gemma_call_{uuid.uuid4().hex[:12]}",
                    "type": "function",
                    "function": {
                        "name": name,
                        "arguments": parameters,
                    },
                }
            ]
        return []

    if not isinstance(raw_payload, list):
        return []

    normalized_calls: List[Dict[str, Any]] = []
    for item in raw_payload:
        normalized_calls.extend(_normalize_prompt_tool_calls(item))
    return normalized_calls


def _extract_gemini_text(payload: Dict[str, Any], *, include_thoughts: bool = False) -> str:
    parts = (
        payload.get("candidates", [{}])[0]
        .get("content", {})
        .get("parts", [])
    )
    text_parts: List[str] = []
    for part in parts:
        if not isinstance(part, dict):
            continue
        if not include_thoughts and part.get("thought") is True:
            continue
        text = _safe_text(part.get("text", ""))
        if text:
            text_parts.append(text)
    return "".join(text_parts).strip()


class GemmaProvider:
    def __init__(self) -> None:
        pass

    def _timeout_seconds(self) -> float:
        timeout_ms = max(5000, int(settings.provider_timeout_ms or 25000))
        return timeout_ms / 1000.0

    def _should_use_gemini_api(self, model: str, endpoint_url: str) -> bool:
        if not _is_google_gemma_model(model):
            return False

        backend = _safe_text(settings.gemma_provider_backend).lower()
        if backend in {"google", "google_gemini", "gemini"}:
            return bool(settings.gemini_api_key)
        if backend in {"huggingface", "hf", "openai_compat"}:
            return False

        if not settings.gemini_api_key:
            return False

        if endpoint_url and not _looks_like_google_api_url(endpoint_url):
            return False

        return True

    def _should_use_hf_compat(self, model: str, endpoint_url: str) -> bool:
        backend = _safe_text(settings.gemma_provider_backend).lower()
        if backend in {"google", "google_gemini", "gemini"}:
            return False
        if backend in {"huggingface", "hf", "openai_compat"}:
            return True

        if self._should_use_gemini_api(model, endpoint_url):
            return False

        return True

    def _create_client(self, endpoint_url: str) -> InferenceClient:
        client_kwargs: Dict[str, str] = {}
        if settings.endpoint_api_key:
            client_kwargs["api_key"] = settings.endpoint_api_key
        if _looks_like_url(endpoint_url):
            client_kwargs["base_url"] = endpoint_url

        return InferenceClient(**client_kwargs)

    def _build_gemini_endpoint(self, model: str, *, stream: bool = False) -> str:
        base_url = settings.gemini_api_base_url.rstrip("/")
        model_name = _normalize_google_gemma_model_name(model)
        action = "streamGenerateContent" if stream else "generateContent"
        return f"{base_url}/models/{model_name}:{action}"

    def _build_gemini_headers(self) -> Dict[str, str]:
        return {
            "Content-Type": "application/json",
            "x-goog-api-key": settings.gemini_api_key,
        }

    def _extract_system_instruction(self, messages: List[Dict[str, Any]]) -> str:
        instructions: List[str] = []
        for message in messages:
            if _safe_text(message.get("role", "")).lower() != "system":
                continue
            text = _coerce_text_content(message.get("content"))
            if text:
                instructions.append(text)
        return "\n\n".join(instructions).strip()

    def _load_inline_media(self, url_or_data: str) -> Optional[Dict[str, str]]:
        normalized = _safe_text(url_or_data)
        if not normalized:
            return None

        data_url_match = DATA_URL_PATTERN.match(normalized)
        if data_url_match:
            mime_type = _safe_text(data_url_match.group("mime")) or "image/jpeg"
            encoded = re.sub(r"\s+", "", data_url_match.group("data"))
            return {
                "mime_type": mime_type,
                "data": encoded,
            }

        if not _looks_like_url(normalized):
            return None

        with httpx.Client(timeout=self._timeout_seconds(), follow_redirects=True) as client:
            response = client.get(normalized)
            response.raise_for_status()
            mime_type = _safe_text(response.headers.get("content-type", "")).split(";", 1)[0]
            if not mime_type:
                mime_type = mimetypes.guess_type(normalized)[0] or "image/jpeg"
            return {
                "mime_type": mime_type,
                "data": base64.b64encode(response.content).decode("utf-8"),
            }

    def _build_gemini_parts(self, content: Any) -> List[Dict[str, Any]]:
        parts: List[Dict[str, Any]] = []
        for part in _iter_content_parts(content):
            if part.get("type") == "text":
                text = _safe_text(part.get("text", ""))
                if text:
                    parts.append({"text": text})
                continue

            if part.get("type") == "image":
                inline_media = self._load_inline_media(part.get("url", ""))
                if inline_media:
                    parts.append(
                        {
                            "inline_data": {
                                "mime_type": inline_media["mime_type"],
                                "data": inline_media["data"],
                            }
                        }
                    )
        return parts

    def _build_gemini_contents(
        self,
        messages: List[Dict[str, Any]],
        *,
        system_instruction: str = "",
    ) -> List[Dict[str, Any]]:
        contents: List[Dict[str, Any]] = []
        instruction_prefix = _safe_text(system_instruction)
        injected_instruction = False
        for message in messages:
            role = _safe_text(message.get("role", "")).lower()
            if role == "system":
                continue

            parts = self._build_gemini_parts(message.get("content"))
            if not parts:
                continue

            if instruction_prefix and not injected_instruction and role in {"user", ""}:
                parts = [
                    {
                        "text": f"Follow these instructions exactly:\n{instruction_prefix}",
                    },
                    *parts,
                ]
                injected_instruction = True

            contents.append(
                {
                    "role": "model" if role in {"assistant", "model"} else "user",
                    "parts": parts,
                }
            )

        if instruction_prefix and not injected_instruction:
            contents.insert(
                0,
                {
                    "role": "user",
                    "parts": [
                        {
                            "text": f"Follow these instructions exactly:\n{instruction_prefix}",
                        }
                    ],
                },
            )
        return contents

    def _build_gemini_payload(
        self,
        *,
        messages: List[Dict[str, Any]],
        model: str,
        temperature: float,
    ) -> Dict[str, Any]:
        system_instruction = self._extract_system_instruction(messages)
        generation_config: Dict[str, Any] = {
            "temperature": temperature,
        }
        if _supports_hosted_gemma_thinking(model):
            generation_config["thinkingConfig"] = {
                "thinkingLevel": _resolve_thinking_level(),
                "includeThoughts": bool(settings.gemma_include_thoughts),
            }
        payload: Dict[str, Any] = {
            "contents": self._build_gemini_contents(
                messages,
                system_instruction=system_instruction,
            ),
            "generationConfig": generation_config,
        }

        return payload

    def _generate_text_gemini_sync(
        self,
        messages: List[Dict[str, Any]],
        model: str,
        temperature: float,
    ) -> Optional[str]:
        payload = self._build_gemini_payload(
            messages=messages,
            model=model,
            temperature=temperature,
        )
        if not payload.get("contents"):
            return None

        with httpx.Client(timeout=self._timeout_seconds(), follow_redirects=True) as client:
            response = client.post(
                self._build_gemini_endpoint(model, stream=False),
                headers=self._build_gemini_headers(),
                json=payload,
            )
            response.raise_for_status()
            data = response.json()
        return _extract_gemini_text(data) or None

    def _plan_tool_calls_with_gemini_sync(
        self,
        messages: List[Dict[str, Any]],
        model: str,
        tools: List[Dict[str, Any]],
        temperature: float,
    ) -> List[Dict[str, Any]]:
        tool_specs = []
        for tool in tools or []:
            function = tool.get("function", {}) if isinstance(tool, dict) else {}
            name = _safe_text(function.get("name", ""))
            if not name:
                continue
            tool_specs.append(
                {
                    "name": name,
                    "description": _safe_text(function.get("description", "")),
                    "parameters": function.get("parameters", {}),
                }
            )

        if not tool_specs:
            return []

        system_messages = [
            _coerce_text_content(message.get("content"))
            for message in messages
            if _safe_text(message.get("role", "")).lower() == "system"
        ]
        user_messages = [
            _coerce_text_content(message.get("content"))
            for message in messages
            if _safe_text(message.get("role", "")).lower() != "system"
        ]
        planner_prompt = "\n\n".join(
            [
                part
                for part in system_messages
                if part
            ]
            + [
                "You are using Gemma as a deliberate tool planner.",
                "Think carefully, then return JSON only.",
                "If tools are needed, return a JSON array in this exact shape:",
                '[{"name":"tool_name","parameters":{}}]',
                "If no tools are needed, return [].",
                "Never include markdown, prose, or explanations.",
                f"Available tools: {json.dumps(tool_specs, ensure_ascii=False)}",
            ]
        ).strip()
        user_prompt = "\n\n".join([part for part in user_messages if part]).strip()
        generated = self._generate_text_gemini_sync(
            [
                {
                    "role": "system",
                    "content": planner_prompt,
                },
                {
                    "role": "user",
                    "content": user_prompt or "Plan the next tool calls.",
                },
            ],
            model,
            temperature,
        )
        parsed = _extract_json_payload(generated or "[]")
        return _normalize_prompt_tool_calls(parsed)

    def _generate_text_sync(
        self,
        messages: List[Dict[str, Any]],
        model: str,
        endpoint_url: str,
        temperature: float,
    ) -> Optional[str]:
        if self._should_use_gemini_api(model, endpoint_url):
            return self._generate_text_gemini_sync(messages, model, temperature)

        if not self._should_use_hf_compat(model, endpoint_url):
            return None

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
        if self._should_use_gemini_api(model, endpoint_url):
            return self._plan_tool_calls_with_gemini_sync(
                messages,
                model,
                tools,
                temperature,
            )

        if not self._should_use_hf_compat(model, endpoint_url):
            return []

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

    async def _stream_text_gemini_async(
        self,
        *,
        messages: List[Dict[str, Any]],
        model: str,
        temperature: float,
        on_token: TokenCallback,
    ) -> Optional[str]:
        loop = asyncio.get_running_loop()
        queue: asyncio.Queue[tuple[str, Any]] = asyncio.Queue()

        def worker() -> None:
            cumulative = ""
            try:
                payload = self._build_gemini_payload(
                    messages=messages,
                    model=model,
                    temperature=temperature,
                )
                with httpx.Client(timeout=self._timeout_seconds(), follow_redirects=True) as client:
                    with client.stream(
                        "POST",
                        self._build_gemini_endpoint(model, stream=True),
                        headers=self._build_gemini_headers(),
                        params={"alt": "sse"},
                        json=payload,
                    ) as response:
                        response.raise_for_status()
                        for raw_line in response.iter_lines():
                            line = _safe_text(raw_line)
                            if not line or not line.startswith("data:"):
                                continue
                            data = _safe_text(line[len("data:"):])
                            if not data or data == "[DONE]":
                                continue
                            payload_json = json.loads(data)
                            chunk_text = _extract_gemini_text(payload_json)
                            if not chunk_text:
                                continue
                            if cumulative and chunk_text.startswith(cumulative):
                                delta = chunk_text[len(cumulative):]
                                cumulative = chunk_text
                            else:
                                delta = chunk_text
                                cumulative += delta
                            if delta:
                                loop.call_soon_threadsafe(queue.put_nowait, ("token", delta))
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
            if self._should_use_gemini_api(model, endpoint_url):
                return await asyncio.wait_for(
                    self._stream_text_gemini_async(
                        messages=messages,
                        model=model,
                        temperature=temperature,
                        on_token=on_token,
                    ),
                    timeout=self._timeout_seconds(),
                )

            if not self._should_use_hf_compat(model, endpoint_url):
                return None

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
