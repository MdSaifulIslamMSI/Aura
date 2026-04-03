from __future__ import annotations

from typing import Any, Dict

import httpx

from .config import settings


class NodeToolGateway:
    def __init__(self) -> None:
        self._client = httpx.AsyncClient(timeout=20.0)

    async def close(self) -> None:
        await self._client.aclose()

    async def run_tool(
        self,
        tool_name: str,
        input_payload: Dict[str, Any] | None = None,
        auth_context: Dict[str, Any] | None = None,
    ) -> Dict[str, Any]:
        response = await self._client.post(
            settings.node_tool_gateway_url,
            headers={
                "Authorization": f"Bearer {settings.node_tool_gateway_token}",
                "X-Intelligence-Service": "gemma4-central-intelligence",
            },
            json={
                "toolName": tool_name,
                "input": input_payload or {},
                "authContext": auth_context or {},
            },
        )
        response.raise_for_status()
        payload = response.json()
        return {
            "toolRun": payload.get("toolRun", {}),
            "result": payload.get("result", {}),
        }
