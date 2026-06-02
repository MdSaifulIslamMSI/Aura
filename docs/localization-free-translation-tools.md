# Free Translation Tooling

The reviewed ICU catalog system can accept machine translation candidates from free/open tooling without weakening localization QA. Machine output is treated as a proposal until it passes ICU, placeholder, glossary, script, and fallback validation.

## Supported Repair Paths

- Self-hosted LibreTranslate: run with `LIBRETRANSLATE_BASE_URL` and use `npm run i18n:translate:repair -- --provider=libretranslate --locale=es --limit=25`.
- Local Ollama draft proposals: use `OLLAMA_TRANSLATION_MODEL=llama3.2:3b` with `npm run i18n:translate:repair -- --provider=ollama --locale=bn --limit=10`.
- NLLB, IndicTrans2, Argos, or other offline tools: produce JSON or JSONL candidates, then validate with `npm run i18n:translate:repair -- --provider=file --input=artifacts/i18n/free-translation-candidates.jsonl`.

Use `--apply` only after reviewing the dry-run output. Applied candidates update `app/src/i18n/messages/reviewed/<locale>.json`, then the normal gates must run:

```sh
npm run i18n:stable-catalogs
npm --prefix app run i18n:check
npm run i18n:language-quality
npm run i18n:human-review-summary
npm run i18n:outperform
```

## Candidate Format

Each JSONL line can target one or many ICU IDs that share the same English source message:

```json
{"locale":"bn","ids":["checkout.applied"],"translatedMessage":"{code} প্রয়োগ করা হয়েছে"}
```

The repair script rejects candidates that:

- break ICU syntax or placeholder structure
- keep exact English fallback without allowlist coverage
- corrupt required brand terms
- include known mojibake or unsafe HTML-like content
- lack expected native-script letters for native-script locales

## Non-Negotiables

- Do not use unofficial Google Translate endpoints.
- Do not reintroduce runtime production translation for stable UI.
- Do not mark machine output as native-certified. Machine output can clear mechanical gates; native language excellence still needs signoff through `nativeReviewAudit.json`.
