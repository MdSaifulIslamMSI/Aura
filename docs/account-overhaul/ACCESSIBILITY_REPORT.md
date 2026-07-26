# Account and Profile Overhaul: Accessibility Report

## Scope and evidence

This report is a code-level audit plus unauthenticated protected-route observation. An authenticated browser session was unavailable, so automated axe results, keyboard traversal, screen-reader announcements, zoom/reflow, and authenticated responsive screenshots remain required.

## Positive current patterns

- A protected route boundary prevents unauthenticated account rendering.
- The implemented Account Center exposes a desktop navigation landmark with `aria-current`, a labeled mobile select, a skip link, one named `main` landmark, and a single route-level `h1`.
- Account-section changes move programmatic focus to the new page heading.
- Account loading and Security refresh states use stable dimensions, live status, and reduced-motion handling.
- Active-session destructive actions use inline confirmation and textual impact instead of native `confirm()`.
- Several security subsections use headings and descriptive copy.
- Recovery and trust actions generally expose textual labels.
- Current device state is expressed in text, not only color.
- MFA center loading and error states have dedicated copy.
- Some security sections use `aria-labelledby`.

## Current risks

### Navigation

- The foundation replaces the horizontal row with an account rail and compact mobile selector.
- Navigation semantics, current state, skip navigation, named main content, and route-heading focus are implemented at component level.
- Authenticated 320–400% reflow, sticky-header focus visibility, and screen-reader behavior remain unverified.

### Forms

- Address inputs rely heavily on placeholders and do not consistently expose persistent labels or field-level error associations.
- Required/optional state and address validation are not consistently communicated.
- Native `confirm()` provides poor control over focus, copy, pending state, and error recovery.
- Bio limits disagree across layers, producing unpredictable accessible error behavior.

### Interactive rows and icon actions

- Notification rows use clickable containers rather than reliable link/button semantics.
- Icon-only mark-read controls rely on `title` rather than a robust accessible name.
- Nested click targets risk duplicate activation and ambiguous focus order.
- Payment/address actions need explicit button types inside forms.

### Focus and status

- Account-wide focus-visible treatment is not consistently owned by the feature.
- Mutation success/error often depends on a shared banner or toast instead of remaining adjacent to the affected control.
- Broad refetches can change content outside the active task and create announcement noise.

### Structure and readability

- Large hero/dashboard composition can push the first task below the fold.
- Repeated rounded panels weaken grouping hierarchy.
- Legacy light components remapped through dark global CSS risk inconsistent contrast.
- Dense settings/support sections create long, difficult reading order.

### Responsive behavior

The live 390 px sign-in capture clips horizontally, but that release SHA differs from this checkout and the issue is outside the authenticated account surface. It is evidence that mobile overflow must be tested rather than assumed.

## Target WCAG 2.2 AA requirements

| Area | Requirement |
|---|---|
| Keyboard | Every task completes without pointer; no traps except correctly managed modal dialogs |
| Focus | Visible, persistent, non-obscured focus; return focus after dialogs |
| Reflow | No two-dimensional scrolling for task content at 320 CSS px or 400% zoom, except legitimate data tables |
| Targets | Minimum 24 CSS px WCAG requirement; project target 44 px |
| Labels | Persistent labels and associated descriptions/errors |
| Errors | Identify field, explain correction, preserve valid input |
| Status | Programmatic live status without forcing focus |
| Contrast | AA text/non-text contrast and 3:1 focus/component boundaries |
| Motion | Reduced-motion support; no required motion interpretation |
| Authentication | Password managers, paste, autofill, and accessible MFA remain supported |
| Destructive actions | Clear impact, deliberate confirmation, cancel path, pending/error state |

## Component acceptance

### Account shell

- One `main` landmark with a unique page heading.
- Rail/mobile navigation has an accessible name and current-page state.
- Skip link lands on the route heading.
- Route changes move focus deliberately without stealing it during background updates.

### Dialog

- Native `<dialog>` or proven equivalent semantics.
- Name, description, focus trap, escape policy, initial safe focus, and trigger return.
- Destructive action is not initial focus.

### Lists/tables

- Responsive rows retain label/value context.
- Sort state and filter results are announced.
- Pagination/load-more controls expose result context and disabled/pending state.

### Offline/partial states

- Status is textual and programmatic.
- Healthy modules remain operable.
- Disabled mutations explain why and how to recover.

## Verification plan

1. Component-level axe checks for every state.
2. Playwright keyboard paths for profile, address, order, notification, session, and deletion dialogs.
3. NVDA + Chrome spot checks on Windows.
4. 200% zoom, 400% reflow, and text-spacing override.
5. Reduced-motion and forced-colors modes.
6. 320–2560 px screenshots.
7. Autofill/password-manager checks for identity and re-auth dialogs.

Component tests verify the shell landmarks/current state and active-session confirmation behavior. No WCAG pass may be claimed until the authenticated automated and manual evidence above is collected.
