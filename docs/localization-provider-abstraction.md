# Localization Provider Abstraction

Date: 2026-06-01

## Purpose

Dynamic translation is isolated behind
`server/services/translation/TranslationService.js`. Production no longer
depends on an unofficial public translation endpoint.

## Providers

| Provider | Intended use |
| --- | --- |
| `noop` | Default, including production. Returns source text without an external call. |
| `mock` | Tests and local deterministic development. Blocked in production. |
| `libretranslate` | Optional self-hosted or approved LibreTranslate-compatible service. |

## Server Flags

```env
I18N_RUNTIME_TRANSLATION_ENABLED=false
I18N_TRANSLATION_PROVIDER=noop
I18N_TRANSLATION_CACHE_ENABLED=true
I18N_TRANSLATION_REQUIRE_AUTH_FOR_HEAVY_USAGE=true
LIBRETRANSLATE_BASE_URL=http://localhost:5000
```

The provider stays `noop` unless runtime translation is explicitly enabled.
Production enablement requires an approved service, capacity review, and a
rollout decision.

## Privacy And Abuse Controls

- Emails, URLs, phone numbers, card-like values, UPI values, OTPs, tokens, and
  order identifiers are redacted before provider calls and restored afterward.
- Sensitive source text is not cached.
- Cache keys are hashed and include provider, locale pair, and glossary version.
- Failures log a text hash, not source text.
- The route has a dedicated distributed limiter. Production does not allow an
  in-memory limiter fallback.
- Anonymous users can translate small batches. Larger batches require sign-in.

## Verification

```sh
npm run scan:i18n-forbidden-endpoints
npm run test:i18n
```
