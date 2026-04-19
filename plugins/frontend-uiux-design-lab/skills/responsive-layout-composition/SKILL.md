---
name: responsive-layout-composition
description: "Build stronger responsive layouts across desktop, tablet, and mobile. Use when tightening section composition, preventing awkward stacking, balancing density across breakpoints, or making a polished desktop UI survive narrow screens."
---

# Responsive Layout Composition

Treat responsiveness as composition, not just shrink-to-fit CSS. Keep hierarchy and usability intact as the viewport changes.

## Workflow

1. Identify the desktop scan path.
2. Decide what must stay visible, what can stack, and what can collapse.
3. Rework spacing and type scale at each breakpoint instead of only resizing width.
4. Protect tap targets, sticky actions, and content order on mobile.
5. Check overflow, wrapping, and empty states on the narrowest realistic width.

## Good Defaults

- Stack in a way that preserves meaning, not just source order.
- Reduce chrome and secondary detail on smaller screens before shrinking everything.
- Keep primary actions within comfortable reach.
- Rebalance spacing when columns collapse into a single axis.

## Guardrails

- Avoid tablet breakpoints that feel like accidental desktop leftovers.
- Avoid sticky elements that cover content or block inputs.
- Avoid carrying desktop density straight into mobile.
