# 0002: Babel transform scoped to svix/jose

Status: Accepted

## Context

`svix` v2 and `jose` (pulled in by `firebase-admin`'s auth submodule via
`jwks-rsa`) are ESM-only, while the server Jest runtime is CommonJS, so their
files must be compiled to CJS. But `@babel/preset-env` injects `'use strict'`
into every module it touches, which turns silent sloppy-mode no-ops into
`TypeError`s — e.g. the `req.query` writes in `server/middleware/validate.js`.
Both `svix` (`^2.2.0`) and `firebase-admin` (`^14.3.0`) are direct server
dependencies; `@babel/core` and `@babel/preset-env` are server devDependencies
used only for this transform.

## Decision

Keep the `transform` in `server/jest.config.js` scoped to the pattern
`node_modules/(svix|jose)/`, with a matching `transformIgnorePatterns`
exception, so project files stay untransformed.

## Consequences

- Project files keep their existing sloppy/strict semantics; middleware such
  as `validate.js` is unaffected by the ESM-compat shim.
- If another ESM-only dependency enters the server graph, it must be added to
  the scope explicitly rather than broadening the transform.
- The scoped transform is what disables mock hoisting for project files,
  which is why 0001 (mocks before requires) is required.
