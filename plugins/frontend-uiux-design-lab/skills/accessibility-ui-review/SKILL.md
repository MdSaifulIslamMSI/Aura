---
name: accessibility-ui-review
description: "Review UI code for accessibility. Use when auditing semantics, focus handling, keyboard access, contrast, labels, zoom and reflow behavior, reduced motion, or responsive readability in frontend components and pages."
---

# Accessibility UI Review

Review interface code for semantics, focus, keyboard access, contrast, motion, and readability. Keep the design intent intact while making the product more usable.

## Fast Pass

1. Inspect headings, landmarks, buttons, links, and form semantics.
2. Confirm that every interactive control has an accessible name.
3. Check focus order, visible focus states, and keyboard access for interactive patterns.
4. Check color contrast and make sure important states are not color-only.
5. Check zoom, reflow, and reduced-motion behavior.

## Output Style

- report findings in priority order
- include the user-visible impact
- point to the component or file when possible
- suggest the smallest safe fix first

## Useful Resources

- Read `references/fast-a11y-checklist.md` for a compact review matrix.
- Use `../../scripts/extract_design_tokens.py <path>` when contrast and token drift look related.

## Guardrails

- Avoid replacing a semantic control with a less semantic workaround.
- Avoid removing focus rings without a deliberate replacement.
- Avoid introducing accessibility fixes that create layout instability or new interaction debt.
