---
name: frontend-polish-pass
description: "Run a late-stage visual and interaction polish pass on implemented frontend work. Use when the feature already works but needs stronger rhythm, cleaner spacing, better responsive behavior, refined states, and more consistent finishing detail."
---

# Frontend Polish Pass

Use this skill near the end of a feature or redesign. The goal is not to reinvent the interface but to tighten rhythm, state coverage, clarity, and finish quality.

## What To Inspect

- spacing cadence and alignment
- edge cases at mobile and tablet widths
- empty, loading, error, and success states
- sticky or floating elements
- icon scale, hit targets, and control density
- copy tone and CTA clarity
- accessibility regressions
- unnecessary visual noise

## Workflow

1. Scan the primary user flow from entry to terminal state.
2. Fix the highest-visibility inconsistencies first.
3. Convert repeated patch-style fixes into token or component-level cleanup.
4. Re-check the surface on narrow widths before calling the work done.

## Useful Resources

- Read `references/final-pass-checklist.md` for a compact finish-line checklist.
- Use `../../assets/ui-review-template.md` when you need a structured handoff or review note.

## Guardrails

- Avoid late decorative flourishes that break the existing system.
- Avoid polishing only the happy path while leaving error and empty states untouched.
- Avoid adding one-off CSS that should really become a shared token or component fix.
