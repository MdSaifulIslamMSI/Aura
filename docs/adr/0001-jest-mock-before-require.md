# 0001: Jest mocks registered before requires

Status: Accepted

## Context

`server/jest.config.js` defines a custom `transform`, which replaces Jest's
default transform for project files. Without the default transform, `jest.mock()`
calls are no longer hoisted to the top of the file. Three suites called
`jest.mock()` after `require()` and silently received the real modules
(`SecurityEventLedger`, `EmergencyAuditLog`, and `logger`) instead of mocks.

## Decision

In every server Jest suite, register all `jest.mock()` calls before any
`require()` of the modules under test. Where a mock factory needs shared
state, use hoist-safe names (e.g. `mockLedgerState`) that do not depend on
closures over variables `jest.mock()` factories cannot see.

## Consequences

- Mocks are guaranteed to be in place before the module registry resolves the
  real implementations; no silent real-module leakage.
- Contributors must keep mock registrations above requires when adding or
  reordering imports in a test file.
- No babel hoisting plugin is added for project files (see 0002 for why the
  transform stays scoped).
