---
name: design-system-forge
description: "Create or refine reusable UI foundations. Use when starting a design system, cleaning inconsistent frontend styling, introducing CSS variables or themes, defining spacing and type scales, or reducing token drift across components."
---

# Design System Forge

Turn a messy UI foundation into a reusable system. Audit what exists before adding new tokens, and prefer semantic structure over one-off styling.

## Workflow

1. Run `../../scripts/extract_design_tokens.py <path>` against the app or style directories to see existing CSS custom properties.
2. Group tokens into primitive, semantic, and component layers using `references/token-architecture.md`.
3. Choose one spacing scale, one radius family, one shadow family, and one motion timing family.
4. Seed missing variables from `../../assets/design-tokens-starter.css` and adapt them to the project instead of copying blindly.
5. Wire components to semantic tokens so theme changes do not require sweeping rewrites.

## Naming Rules

- Use primitive names for raw values such as `--color-slate-900`.
- Use semantic names for roles such as `--surface-primary` or `--text-muted`.
- Use component tokens only when a component truly needs a local override such as `--card-border`.

## Good Defaults

- Keep spacing to a deliberate scale instead of inventing values per component.
- Favor semantic aliases in component CSS.
- Handle theme changes by remapping semantics, not by rewriting component rules.
- Remove duplicate tokens when two names carry the same job.

## Useful Resources

- Read `references/token-architecture.md` before inventing a naming scheme.
- Use `../../assets/design-tokens-starter.css` as a starter, not as a final design system.

## Guardrails

- Avoid mixing raw color values directly into feature components once tokens exist.
- Avoid creating a new token for every visual exception.
- Avoid using semantic tokens with encoded values in the name such as `--surface-blue-12`.
