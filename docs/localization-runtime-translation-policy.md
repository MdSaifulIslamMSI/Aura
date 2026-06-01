# Runtime Translation Policy

Date: 2026-06-01

## Default Posture

Stable UI copy is reviewed catalog content. Runtime translation is an optional
dynamic-content aid, not a substitute for reviewed interface localization.

## Frontend Flags

```env
VITE_I18N_FORMATJS_ENABLED=false
VITE_I18N_RUNTIME_TRANSLATION_ENABLED=false
VITE_I18N_STABLE_UI_RUNTIME_TRANSLATION_ENABLED=false
VITE_I18N_PSEUDO_LOCALE_ENABLED=false
```

`VITE_I18N_STABLE_UI_RUNTIME_TRANSLATION_ENABLED` exists only as a migration
escape hatch. Keep it disabled for production releases.

`VITE_I18N_PSEUDO_LOCALE_ENABLED` exposes `en-XA` for QA builds. It must remain
disabled in user-facing builds.

## Allowed Dynamic Content

- product and listing titles
- seller descriptions
- reviews and support text
- chat and other user-generated content

## Disallowed Stable Content

- authentication and account recovery
- checkout and payment actions
- navigation and accessibility labels
- legal, trust, security, and error copy

Those messages require reviewed catalogs and ordinary release review.
