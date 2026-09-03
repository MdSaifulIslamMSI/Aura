# Architecture Decision Records

Short, factual records of decisions that constrain how this repo is built and
tested. Each record is Status / Context / Decision / Consequences and is based
only on what is visible in the repo (configs, manifests, package files).

| ID | Title | Status |
|----|-------|--------|
| [0001](0001-jest-mock-before-require.md) | Jest mocks registered before requires | Accepted |
| [0002](0002-scoped-svix-jose-transform.md) | Babel transform scoped to svix/jose | Accepted |
| [0003](0003-npm10-lockfile-discipline.md) | Lockfile must validate under npm 10 and npm 11 | Accepted |
| [0004](0004-tiered-test-execution.md) | Tiered test execution with regression as CI gate | Accepted |

Add new records as `NNNN-short-title.md` with the next free number and link
them in the table above.
