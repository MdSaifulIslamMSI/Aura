# Account and Profile Overhaul: Design System

## Direction

Primary direction: **Tactile Minimal**.

Supporting accent: **Editorial Commerce**.

The Account Center should feel like a calm, high-trust utility inside a premium marketplace. Product imagery appears in commerce contexts; settings and security remain precise and quiet. The design must not mimic an admin dashboard.

## Visual concept boards

These generated images are directional artifacts. Text, product data, routes, and controls are illustrative; implementation must use real server contracts and verified states.

1. [Overview, desktop and mobile](concepts/01-account-overview-desktop-mobile.png)
2. [Orders, profile, and addresses](concepts/02-orders-profile-addresses.png)
3. [Security, sessions, and destructive confirmation](concepts/03-security-sessions-destructive-confirmation.png)
4. [Loading, empty, error, success, offline, and partial states](concepts/04-account-state-language.png)

The concepts were generated after the code and UX audit. Prompts required the Aura palette, desktop/mobile task hierarchy, semantic state coverage, session/device separation, accessible destructive actions, and explicit rejection of generic dashboard patterns.

## Color roles

Use existing Aura tokens where they meet contrast requirements; introduce account aliases rather than scattering new literals.

| Role | Direction | Rule |
|---|---|---|
| Canvas | Warm ivory | Primary account background |
| Ink | Deep green-black | Main text and primary controls |
| Surface | Ivory/white shift | Use sparingly for grouped tasks, not every paragraph |
| Border | Visible warm gray | 1 px structural separation |
| Brand accent | Muted bronze | Selection and editorial emphasis |
| Information | Restrained cyan | Informative state only |
| Success | Deep green | Text + icon, never color alone |
| Warning | Warm amber | Requires explanatory text |
| Destructive | Deep red | Reserved for irreversible/high-impact actions |

All text/background combinations must meet WCAG 2.2 AA contrast. Focus indicators target at least 3:1 contrast against adjacent colors.

## Typography

- Use the established Aura editorial face only for page titles and rare commerce moments.
- Use the existing UI sans for labels, controls, body copy, tables, and statuses.
- Avoid viewport-scaled type in task surfaces.
- Page title: 32–44 px desktop, 28–34 px mobile.
- Body: 16 px preferred, 14 px minimum for secondary metadata.
- Labels remain visible; placeholders are examples, never substitutes.
- Numeric order/payment/reward data may use tabular numerals.

## Layout and spacing

- Desktop: persistent account rail, content max width around 1120 px, reading column 640–760 px for forms.
- Tablet: collapsible rail or two-level account navigation without horizontal overflow.
- Mobile: one task hierarchy, no desktop grid squeezed into columns, primary action remains reachable without obscuring content.
- Minimum horizontal content padding: 16 px mobile, 24 px tablet, 32 px desktop.
- Spacing uses an 8 px rhythm with 4 px for tightly related label/help relationships.
- Corners: 10–12 px default; avoid nested rounded containers.
- Elevation: nearly flat; use borders and spacing before shadows.

## Component rules

### Navigation

- Desktop rail uses links with current-page semantics.
- Mobile account index is a list or disclosure, not a scrolling pill row.
- Preserve deep links and browser history.
- `aria-current="page"` identifies the active route.

### Forms

- Each input has a persistent label, optional description, and stable error region.
- Required/optional status is textually clear.
- Server errors map to fields when safe; generic failures use an adjacent page status with a request reference.
- Dirty forms warn before navigation.
- Save actions show pending and success without resetting unrelated fields.

### Lists and histories

- Use rows for comparable records and cards only when imagery/context materially benefits.
- Entire rows are links only when keyboard and nested-action semantics remain valid.
- Histories expose pagination/load-more, count context, and stable empty/error states.

### Dialogs

- Use dialogs for deliberate high-impact confirmation, not routine deletion where undo is available.
- State the exact impact and whether the current session/item is preserved.
- Cancel remains first in keyboard and visual order.
- Focus moves into the dialog and returns to the trigger.
- Error and pending feedback remain inside the dialog.

### Status language

Every module implements:

- initial loading with layout-preserving skeletons;
- empty with one useful next action;
- local error with retry and reference when available;
- success adjacent to the changed content;
- offline/stale with timestamp and mutation policy;
- partial data without blanking healthy modules.

Status uses text plus icon, never color alone. Live-region priority is proportional: `polite` for loading/success and `assertive` only for blocking errors.

## Interaction and motion

- 44 by 44 px minimum pointer targets.
- Visible `:focus-visible` outline with non-color shape/offset.
- Hover must not shift layout.
- Motion is limited to short state transitions and skeleton/progress feedback.
- Respect `prefers-reduced-motion`.
- Do not animate security or destructive actions in a celebratory way.

## Prohibited patterns

- Giant account hero copy.
- Purple/blue identity gradients.
- Low-contrast dark slate card stacks.
- Pills for every state or navigation item.
- Cards inside cards.
- Decorative blobs, glassmorphism, floating panels, or fake charts.
- Icon-only actions without accessible names.
- Toast-only mutation feedback.
- Disabled controls without an explanation when the user can resolve the condition.

## Wave K implementation

The integration branch now owns the Account Center presentation through the
`account-center-experience` scope. It intentionally removes the legacy profile
grid/radial backdrop and broad dark remapping selectors without changing
checkout styling.

- Light mode uses warm ivory canvas, deep ink text, visible warm-gray borders,
  restrained bronze selection and nearly flat surfaces.
- Dark mode uses a calm deep-green canvas and keeps structural borders visible.
- The desktop rail, mobile section picker, route header, state notice and
  section fallback share the same account-specific tokens and 12 px corner
  scale.
- Account controls target at least 44 by 44 px, a 3 px offset focus indicator,
  reduced-motion behavior, forced-colors boundaries and single-column reflow.
- Avatar images have explicit dimensions, and lazy section fallbacks preserve
  content height to reduce layout shift.

The static interface audit reports 0 high, 8 medium and 2 low heuristic
findings. The medium findings were inspected and are `Card` symbol/fixture or
intentional row/card-layout matches rather than eight confirmed nesting
defects. The two low findings are deliberate tight tracking on a route display
heading and numeric summary display. Authenticated visual comparison remains
required before release.

## Responsive acceptance widths

Visual and keyboard evidence is required at 320, 375, 390, 768, 1024, 1280, 1440, 1920, and 2560 px, plus 200% browser zoom and 400% text reflow where applicable.
