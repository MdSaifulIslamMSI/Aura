# 0003: Lockfile must validate under npm 10 and npm 11

Status: Accepted

## Context

Root and server each carry a `package-lock.json` (both `lockfileVersion: 3`).
`mongodb` (via `mongoose`/`mongodb-memory-server`) requires
`gcp-metadata@^7.0.1`, but the server lockfile only carried the hoisted
`8.1.2`, so `npm --prefix server ci` under npm 10 failed with
`EUSAGE 'Missing: gcp-metadata@7.0.1 from lock file'`. npm 10 is the stricter
toolchain here: entries it requires may be tolerated-but-unrecorded by npm 11,
so a lockfile regenerated only with npm 11 can break npm 10 installs.

## Decision

The lockfiles must validate under both npm 10 and npm 11
(`npm ci --dry-run` passes on each). After dependency changes, regenerate with
the stricter toolchain (npm 10) so nested entries it demands (e.g. the nested
`gcp-metadata@7.0.1` entries) are recorded.

## Consequences

- CI surfaces pinned to npm 10 keep installing cleanly; npm 11 users are
  unaffected by the extra recorded entries.
- Dependency updates require a dual-version `npm ci --dry-run` check before
  merge.
- contributors must not hand-edit lockfiles; regenerate via the package
  manager instead.
