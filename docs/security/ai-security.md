# AI Security

## Enforced Now

- AI write routes are classified as `AI_TOOL_ACTION` by the central sensitive-action policy.
- AI audit event categories exist for allow and deny decisions.
- Existing AI route tests and validators continue to cover provider and media validation surfaces.

## Guardrails

- Never pass raw env, secrets, tokens, cookies, private keys, webhook secrets, payment secrets, or raw Authorization headers to a model provider.
- Minimize user data before model calls.
- Route any AI action that can mutate admin, payment, order, upload, or recovery state through the sensitive-action policy.
- Keep AI tool names allowlisted; do not let model text dynamically choose internal route names.
- Validate media input with the upload security pipeline before AI processing.

## Local Commands

```sh
npm --prefix server test -- --runTestsByPath tests/aiRoutes.test.js tests/aiControllerMediaValidation.test.js tests/assistantToolRegistry.test.js tests/aiRateLimitPolicy.test.js --forceExit
```

## Remaining Work

- Add explicit tests proving AI tools cannot invoke payment/admin actions without policy approval.
- Add prompt-injection regression fixtures for admin/payment/tool-call attempts.
- Add provider-specific data minimization assertions.
