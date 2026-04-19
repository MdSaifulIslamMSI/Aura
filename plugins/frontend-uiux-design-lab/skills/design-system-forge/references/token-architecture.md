# Token Architecture

## Layers

- Primitive tokens hold raw values such as palettes, spacing steps, shadows, and radii.
- Semantic tokens describe roles such as page surface, muted text, focus ring, or action background.
- Component tokens exist only when a component has a real local need that should not leak into the whole system.

## Naming

Prefer names like:

- `--color-slate-900`
- `--surface-primary`
- `--text-muted`
- `--radius-card`
- `--shadow-overlay`

Avoid names that encode both role and exact value, such as `--surface-blue-12`.

## Theming

- Map themes by changing semantic token values, not by rewriting component CSS.
- Keep dark theme overrides shallow and predictable.
- Reuse spacing, radius, and motion families across themes.

## File Split

- `tokens/base.css`
- `tokens/semantic.css`
- `tokens/components.css`
- `theme/dark.css`

## Rules Of Thumb

- Six to eight spacing steps are enough for most products.
- Semantic tokens should cover the repeated jobs before component tokens are introduced.
- Delete duplicate tokens when two names serve the same purpose.
