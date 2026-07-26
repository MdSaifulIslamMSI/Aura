# Account Center Localization Contract

Localization is part of each Account Center wave, not a release-end translation pass.

## Required implementation pattern

- Add stable ICU message IDs at the same time as user-visible UI.
- Keep English source copy as the reviewable fallback.
- Use locale-aware date, time, number, currency, and plural formatting.
- Preserve right-to-left layout behavior for Arabic and Urdu.
- Keep labels, descriptions, validation errors, status messages, dialogs, and live-region announcements localizable.
- Avoid concatenated sentences, computed message IDs, raw stable literals, and locale authority stored only in local storage.
- Keep server error codes stable and map them to localized customer copy at the UI boundary.
- Include `en-XA` pseudo-locale coverage for truncation, reflow, and missing-message detection.

## Per-wave gates

Run after every wave that changes user-visible text:

```sh
npm run test:i18n
npm --prefix app run i18n:check
npm run i18n:language-quality
npm run i18n:outperform
npm run i18n:discover-text:check
```

Also run the wave's responsive and accessibility tests in at least English, the pseudo-locale, one right-to-left locale, and one long-text locale.

## Review semantics

- Structural key coverage is not native-language approval.
- Generated or repaired translations are not marked human reviewed without human evidence.
- `i18n:language-quality:final` remains a production gate when final native-language certification is required.
- Missing authoritative linguistic review is reported as a release blocker, never converted into a skipped or passing check.

## Current baseline

The merged foundation has 21 structurally valid catalogs, 4,733 ICU source messages, 100% key coverage, and no mechanical blockers. Nineteen non-English locale rows still have a pre-existing native-review backlog, so the strict final native-quality command is not currently green.
