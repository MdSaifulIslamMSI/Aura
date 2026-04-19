#!/usr/bin/env python3
"""Scan a project for CSS custom properties and group them by token type."""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections import defaultdict
from pathlib import Path

CSS_VAR_PATTERN = re.compile(r"(?P<name>--[a-zA-Z0-9_-]+)\s*:\s*(?P<value>[^;{}]+)")
SUPPORTED_SUFFIXES = {
    ".css",
    ".scss",
    ".sass",
    ".less",
    ".ts",
    ".tsx",
    ".js",
    ".jsx",
}
IGNORED_DIRS = {
    ".git",
    ".next",
    ".nuxt",
    ".vercel",
    ".netlify",
    ".turbo",
    "build",
    "coverage",
    "dist",
    "node_modules",
    "out",
}


def collect_files(paths: list[Path]) -> list[Path]:
    discovered: list[Path] = []
    for raw_path in paths:
      path = raw_path.resolve()
      if not path.exists():
          continue
      if path.is_file() and path.suffix.lower() in SUPPORTED_SUFFIXES:
          discovered.append(path)
          continue
      if not path.is_dir():
          continue
      for child in path.rglob("*"):
          if any(part in IGNORED_DIRS for part in child.parts):
              continue
          if child.is_file() and child.suffix.lower() in SUPPORTED_SUFFIXES:
              discovered.append(child)
    return discovered


def categorize_token(name: str) -> str:
    lowered = name.lower()
    if any(label in lowered for label in ("color", "surface", "text", "border", "action", "focus")):
        return "color"
    if "space" in lowered or "gap" in lowered or "padding" in lowered or "margin" in lowered:
        return "spacing"
    if "radius" in lowered:
        return "radius"
    if "shadow" in lowered or "blur" in lowered:
        return "shadow"
    if "font" in lowered or "line" in lowered or "tracking" in lowered or "text-" in lowered:
        return "typography"
    if "duration" in lowered or "ease" in lowered or "motion" in lowered:
        return "motion"
    return "other"


def scan_file(path: Path) -> list[dict[str, str]]:
    try:
        content = path.read_text(encoding="utf-8", errors="ignore")
    except OSError:
        return []

    tokens: list[dict[str, str]] = []
    for match in CSS_VAR_PATTERN.finditer(content):
        name = match.group("name").strip()
        value = " ".join(match.group("value").strip().split())
        tokens.append(
            {
                "name": name,
                "value": value,
                "category": categorize_token(name),
                "file": str(path),
            }
        )
    return tokens


def render_markdown(grouped: dict[str, list[dict[str, str]]]) -> str:
    lines: list[str] = []
    total = sum(len(items) for items in grouped.values())
    lines.append(f"# Design Token Scan\n")
    lines.append(f"Found {total} CSS custom properties.\n")
    for category in ("color", "spacing", "radius", "shadow", "typography", "motion", "other"):
        items = grouped.get(category, [])
        if not items:
            continue
        lines.append(f"## {category.capitalize()}")
        for item in items:
            lines.append(f"- `{item['name']}` = `{item['value']}`")
            lines.append(f"  Source: `{item['file']}`")
        lines.append("")
    return "\n".join(lines).rstrip() + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Scan a project or directory for CSS custom properties.",
    )
    parser.add_argument(
        "paths",
        nargs="+",
        help="Files or directories to scan",
    )
    parser.add_argument(
        "--format",
        choices=("markdown", "json"),
        default="markdown",
        help="Output format",
    )
    args = parser.parse_args()

    files = collect_files([Path(value) for value in args.paths])
    grouped: dict[str, list[dict[str, str]]] = defaultdict(list)

    seen: set[tuple[str, str, str]] = set()
    for file_path in files:
        for token in scan_file(file_path):
            identity = (token["name"], token["value"], token["file"])
            if identity in seen:
                continue
            seen.add(identity)
            grouped[token["category"]].append(token)

    for items in grouped.values():
        items.sort(key=lambda item: (item["name"], item["file"]))

    if args.format == "json":
        json.dump(grouped, sys.stdout, indent=2)
        sys.stdout.write("\n")
        return 0

    sys.stdout.write(render_markdown(grouped))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
