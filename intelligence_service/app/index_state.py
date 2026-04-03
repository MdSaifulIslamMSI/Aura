from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from .config import settings


def _resolve_path(path: Path | None = None) -> Path:
    return Path(path or settings.active_index_path)


def read_active_index(path: Path | None = None) -> dict[str, Any]:
    resolved_path = _resolve_path(path)
    if not resolved_path.exists():
        return {
            "status": "missing",
            "bundleVersion": "",
        }

    try:
        return json.loads(resolved_path.read_text(encoding="utf-8"))
    except Exception as exc:  # pragma: no cover - defensive path
        return {
            "status": "error",
            "bundleVersion": "",
            "reason": str(exc),
        }


def write_active_index(payload: dict[str, Any], path: Path | None = None) -> dict[str, Any]:
    resolved_path = _resolve_path(path)
    resolved_path.parent.mkdir(parents=True, exist_ok=True)
    resolved_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    return payload
