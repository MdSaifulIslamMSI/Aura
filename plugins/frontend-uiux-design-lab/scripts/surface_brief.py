#!/usr/bin/env python3
"""Turn a vague UI request into a structured surface brief."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

SURFACE_DEFAULTS = {
    "landing": {
        "sections": [
            "hero",
            "social proof",
            "problem and solution",
            "feature detail",
            "proof or trust",
            "final CTA",
        ],
        "interaction_notes": [
            "Make the primary CTA visible without scrolling on desktop.",
            "Alternate dense sections with breathing room so the page does not flatten.",
            "Use image treatment or art direction to give the hero a clear identity.",
        ],
    },
    "commerce": {
        "sections": [
            "merchandising hero or collection header",
            "filter and sort rail",
            "product grid or PDP detail",
            "trust and delivery information",
            "supporting recommendations",
            "sticky purchase action",
        ],
        "interaction_notes": [
            "Keep price, offer, stock, and delivery signals visually close.",
            "Preserve filter state and reduce compare friction.",
            "Favor stable CTA placement over flashy merchandising motion.",
        ],
    },
    "dashboard": {
        "sections": [
            "summary rail",
            "primary chart or KPI canvas",
            "filters and date controls",
            "detail table or inspector",
            "activity or alerts",
        ],
        "interaction_notes": [
            "Keep the scan path left-to-right and top-to-bottom.",
            "Use contrast to separate summary from detail.",
            "Avoid visual noise that competes with the core data view.",
        ],
    },
    "auth": {
        "sections": [
            "headline and trust cue",
            "form",
            "supporting reassurance",
            "secondary path",
        ],
        "interaction_notes": [
            "Make the submit action obvious and reduce label ambiguity.",
            "Keep supporting copy short and calming.",
            "Treat validation and error states as first-class design surfaces.",
        ],
    },
    "pricing": {
        "sections": [
            "plan framing",
            "comparison grid",
            "feature detail",
            "FAQ or objections",
            "final CTA",
        ],
        "interaction_notes": [
            "Lead with plan differentiation, not decorative cards.",
            "Make the recommended tier easy to compare without dark patterns.",
            "Keep billing cadence and savings copy explicit.",
        ],
    },
    "docs": {
        "sections": [
            "search and navigation",
            "page summary",
            "code examples",
            "related references",
            "next steps",
        ],
        "interaction_notes": [
            "Navigation should stay predictable across long pages.",
            "Use type scale and callouts to separate concept from code.",
            "Do not let decorative UI crowd out readability.",
        ],
    },
}


def detect_surface(raw_brief: str, explicit_surface: str) -> str:
    if explicit_surface != "auto":
        return explicit_surface
    lowered = raw_brief.lower()
    keywords = {
        "commerce": ("shop", "store", "cart", "checkout", "product", "marketplace"),
        "dashboard": ("dashboard", "analytics", "chart", "metrics", "kpi"),
        "auth": ("login", "sign in", "register", "authentication", "otp"),
        "pricing": ("pricing", "plans", "subscription", "billing"),
        "docs": ("docs", "documentation", "guide", "reference", "api"),
    }
    for surface, terms in keywords.items():
        if any(term in lowered for term in terms):
            return surface
    return "landing"


def infer_tone(raw_brief: str) -> list[str]:
    lowered = raw_brief.lower()
    tone: list[str] = []
    if any(word in lowered for word in ("luxury", "premium", "elegant", "fashion")):
        tone.append("premium warmth")
    if any(word in lowered for word in ("playful", "youth", "creator", "fun")):
        tone.append("playful utility")
    if any(word in lowered for word in ("bold", "editorial", "statement", "brand-heavy")):
        tone.append("editorial contrast")
    if any(word in lowered for word in ("fast", "utility", "productivity", "marketplace", "fintech")):
        tone.append("precision commerce")
    if not tone:
        tone.append("precision commerce")
    return tone


def build_brief(raw_brief: str, surface: str) -> dict[str, object]:
    defaults = SURFACE_DEFAULTS[surface]
    return {
        "surface": surface,
        "prompt": raw_brief.strip(),
        "visual_direction": infer_tone(raw_brief),
        "must_have_sections": defaults["sections"],
        "interaction_notes": defaults["interaction_notes"],
        "accessibility_notes": [
            "Preserve a visible focus style on all interactive elements.",
            "Keep heading structure and landmark order obvious.",
            "Avoid motion that hides state changes or creates layout shift.",
        ],
        "risks_to_avoid": [
            "A generic hero followed by repetitive card blocks.",
            "Secondary actions that visually compete with the main CTA.",
            "Dense surfaces without spacing contrast or scanning hierarchy.",
        ],
    }


def to_markdown(brief: dict[str, object]) -> str:
    lines = ["# Surface Brief", ""]
    lines.append(f"- Surface: `{brief['surface']}`")
    lines.append(f"- Prompt: {brief['prompt']}")
    lines.append("")
    lines.append("## Visual Direction")
    for item in brief["visual_direction"]:
        lines.append(f"- {item}")
    lines.append("")
    lines.append("## Must-Have Sections")
    for item in brief["must_have_sections"]:
        lines.append(f"- {item}")
    lines.append("")
    lines.append("## Interaction Notes")
    for item in brief["interaction_notes"]:
        lines.append(f"- {item}")
    lines.append("")
    lines.append("## Accessibility Notes")
    for item in brief["accessibility_notes"]:
        lines.append(f"- {item}")
    lines.append("")
    lines.append("## Risks To Avoid")
    for item in brief["risks_to_avoid"]:
        lines.append(f"- {item}")
    lines.append("")
    return "\n".join(lines)


def load_prompt(args: argparse.Namespace) -> str:
    if args.brief:
        return args.brief
    if args.file:
        return Path(args.file).read_text(encoding="utf-8")
    raise ValueError("Provide either --brief or --file.")


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Convert a UI request into a structured surface brief.",
    )
    parser.add_argument(
        "--surface",
        default="auto",
        choices=("auto", "landing", "commerce", "dashboard", "auth", "pricing", "docs"),
        help="Preferred surface type",
    )
    parser.add_argument("--brief", help="Short prompt describing the UI")
    parser.add_argument("--file", help="Path to a text file containing the prompt")
    parser.add_argument(
        "--format",
        default="markdown",
        choices=("markdown", "json"),
        help="Output format",
    )
    args = parser.parse_args()

    prompt = load_prompt(args)
    surface = detect_surface(prompt, args.surface)
    brief = build_brief(prompt, surface)

    if args.format == "json":
        print(json.dumps(brief, indent=2))
    else:
        print(to_markdown(brief))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
