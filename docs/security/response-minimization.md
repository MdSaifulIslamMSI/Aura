# Response Minimization

Production responses should not leak stacks, file paths, provider internals, database details, route classification, secret names, or framework internals.

## Behavior

- Generic production 500 responses return `Request failed` and a request ID.
- Admin cloak turns anonymous and non-admin admin errors into generic not-found responses.
- Legitimate admin step-up errors remain actionable.
- Internal details stay in structured server logs after audit redaction.

## Verification

Run:

```sh
npm --prefix server test -- --runTestsByPath tests/responseMinimizer.test.js --forceExit
```

The broader umbrella gate includes related route and authz checks.
