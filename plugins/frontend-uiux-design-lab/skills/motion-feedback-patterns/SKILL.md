---
name: motion-feedback-patterns
description: "Add purposeful interface motion and feedback. Use when refining transitions, hover and press states, async feedback, loading behavior, route changes, or interaction choreography for frontend UI without turning the product into decorative animation."
---

# Motion Feedback Patterns

Use motion to explain change, not to decorate every pixel. Every animation should help the user understand state, hierarchy, or cause and effect.

## Principles

- Animate the element that changed.
- Keep durations short enough to feel responsive.
- Respect reduced motion and preserve layout stability.
- Use motion to reinforce hierarchy, not compete with it.

## Timing Defaults

- `120ms` to `180ms` for hover, press, focus, and toggle feedback
- `180ms` to `280ms` for drawers, cards, and inline transitions
- `280ms` to `420ms` only for larger route or surface transitions with clear payoff

## Good Uses

- hover lift with a stable focus ring
- add-to-cart or favorite feedback
- loading to success transitions
- skeleton to content reveals
- panel open and close transitions with anchored motion

## Useful Resources

- Read `references/motion-rules.md` for pacing and easing guidance.
- Reuse timing ideas from `../../assets/design-tokens-starter.css` when building tokenized motion values.

## Guardrails

- Avoid continuous floating, bobbing, or decorative looping motion.
- Avoid springy motion in serious or high-trust flows unless the product language already supports it.
- Avoid animations that cause content shift or hide whether an action succeeded.
