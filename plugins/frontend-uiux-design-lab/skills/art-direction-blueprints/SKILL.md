---
name: art-direction-blueprints
description: "Shape visual direction for frontend work. Use when a user wants a stronger look and feel, typography or color direction, a moodboard translated into interface decisions, or a generic page upgraded into a more intentional landing page, dashboard, app shell, or commerce surface."
---

# Art Direction Blueprints

Turn vague taste words into concrete interface decisions that can be implemented in code. Keep one clear direction and carry it through typography, color, spacing, surfaces, imagery, and motion.

## Workflow

1. Extract the product promise, audience, and desired emotional tone from the request or project context.
2. Pick one direction from `references/style-directions.md` instead of blending several contradictory styles.
3. Translate that direction into six concrete outputs: type pair, palette, surface treatment, spacing rhythm, image treatment, and motion stance.
4. State a short "do and do not" list so implementation does not slide back to generic defaults.

## Output Contract

When using this skill, always name the chosen direction and specify:

- headline or display type behavior
- body or UI type behavior
- accent color strategy
- background and surface strategy
- spacing and density rhythm
- interaction and motion tone
- mistakes to avoid

## Strong Defaults

- Favor distinctive typography over decorative chrome.
- Prefer one confident accent color plus a disciplined neutral system.
- Let the hero or lead surface carry the strongest visual energy.
- Preserve the existing design language when the product already has one. Push it forward instead of replacing it casually.

## Useful Resources

- Read `references/style-directions.md` when the user asks for options or wants a direction chosen.
- Use `../../scripts/surface_brief.py --surface landing --brief "<prompt>"` or another surface type when the request is still vague and needs a concrete brief.

## Guardrails

- Avoid default purple-on-white styling unless the product already uses it.
- Avoid mixing unrelated trends such as glassmorphism, brutalism, and playful sticker UI in one surface.
- Avoid a hero that looks branded while the rest of the page collapses into generic card repetition.
