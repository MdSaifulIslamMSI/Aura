# Dead Code Policy

Knip starts in report mode:

```sh
npm run quality:deadcode
```

The report is written to ignored `reports/quality/knip.txt`. It is intentionally non-blocking while the legacy baseline is triaged.

Do not delete a reported file or dependency until:

1. Dynamic imports, runtime paths, workflow references, and package scripts are checked.
2. The relevant test suite passes.
3. The relevant build passes.
4. The change is reviewed as a separate cleanup PR.

Set `QUALITY_DEADCODE_STRICT=true` only after the baseline is clean enough to become a merge gate.
