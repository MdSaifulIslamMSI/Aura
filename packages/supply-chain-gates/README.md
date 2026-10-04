# @aurasec/supply-chain-gates

Three fail-closed CI gates that block poisoned npm dependencies from reaching your install step. Zero runtime dependencies, Node ≥ 20.

```sh
npx @aurasec/supply-chain-gates allow-scripts
npx @aurasec/supply-chain-gates registry
npx @aurasec/supply-chain-gates freshness
```

## Why this exists

Modern npm attacks don't need to hack your code — they wait for you to install theirs. Three patterns drove the 2025–2026 npm worm waves:

1. **Poisoned lifecycle scripts.** A transitive dependency ships a `postinstall` script that runs during `npm ci` — often in CI, where secrets (cloud tokens, `GITHUB_TOKEN`) are in scope. npm 11 only *warns* about uncovered scripts; it does not stop them.
2. **Hand-edited or hijacked lockfiles.** A lockfile entry that points at a random host, a `git+` URL, or lacks an integrity hash is how attacker-controlled tarballs sneak past a frozen `npm ci`.
3. **Same-day malicious releases.** Poisoned versions are usually yanked from the registry within days — but automation that merges dependency bumps the moment they appear installs them before anyone notices.

Each gate here turns one of those patterns into a hard build failure. All three were built for and run in production CI ([Aura](https://github.com/MdSaifulIslamMSI/Aura)) since 2026; the registry gate caught a real regression where 871 lockfile entries lost their integrity hashes.

## The gates

### `allow-scripts` — every install script needs a human decision

Parses each lockfile for packages with `hasInstallScript: true` and fails unless the workspace's `package.json` explicitly allowlists each one:

```jsonc
// package.json
{
  "allowScripts": {
    "esbuild": true
  }
}
```

It also fails when an allowlist entry covers no package in the lockfile anymore — stale entries rot the list until it stops meaning anything. This matches npm 12's native `allowScripts` enforcement, so adopting it now is forward-compatible.

### `registry` — every lockfile entry must be the official registry

For every `node_modules/**` entry (skipping `link:` entries and the root), it requires:

- `resolved` is an `https://` URL on `registry.npmjs.org` (configurable),
- the tarball path matches `name@version` (`/@scope/name/-/name-version.tgz`),
- an `integrity` hash with the `sha512-` prefix (sha1 is rejected).

Anything else — arbitrary hosts, mismatched tarball paths, missing hashes — fails.

### `freshness` — changed dependency versions must age before they can ship

Compares your lockfiles against a base git revision (a PR's merge-base, a push's previous SHA, or `HEAD~1`), finds every **new or changed** `name@version`, and asks the npm registry how long ago that version was published. Anything younger than the cooldown window (default **7 days**) fails — unless it has an explicit, **expiring** allowlist entry.

The allowlist is fail-closed: every entry needs a `reason` and an `expires` date, and expired entries fail the build themselves.

```jsonc
// lockfile-freshness-allowlist.json
{
  "allowed": [
    { "name": "left-pad", "reason": "critical security fix, reviewed", "expires": "2026-11-01T00:00:00Z" }
  ]
}
```

Base revision resolution order: `--base` flag → `$GITHUB_BASE_REF` (pull_request events: merge-base with `origin/<ref>`) → `$GITHUB_EVENT_BEFORE` (push events: that SHA) → `HEAD~1`. Requires the `git` CLI; nothing else.

## Usage

```sh
# Single project (uses ./package-lock.json and ./package.json)
aurasec-supply-chain allow-scripts
aurasec-supply-chain registry

# Monorepo: repeat --lockfile / --package-json pairs in order
aurasec-supply-chain allow-scripts \
  --lockfile package-lock.json --package-json package.json \
  --lockfile app/package-lock.json --package-json app/package.json \
  --lockfile server/package-lock.json --package-json server/package.json
```

Full flag reference: `aurasec-supply-chain --help`. Flags accept `--flag=value` or `--flag value`; unknown flags are a usage error (exit 2). Exit codes: **0** pass, **1** gate failure, **2** usage error.

### GitHub Actions

```yaml
jobs:
  supply-chain-integrity:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0   # freshness compares against the merge-base
      - uses: actions/setup-node@v4
        with:
          node-version: 24
      - name: Lifecycle scripts are allowlisted
        run: npx --yes @aurasec/supply-chain-gates allow-scripts \
          --lockfile package-lock.json --package-json package.json
      - name: Lockfiles resolve only to the official registry
        run: npx --yes @aurasec/supply-chain-gates registry \
          --lockfile package-lock.json
      - name: Changed versions clear the release cooldown
        run: npx --yes @aurasec/supply-chain-gates freshness \
          --lockfile package-lock.json \
          --allowlist lockfile-freshness-allowlist.json
        env:
          GITHUB_BASE_REF: ${{ github.base_ref }}
          GITHUB_EVENT_BEFORE: ${{ github.event.before }}
```

For maximum pinning discipline, commit a lockfile for the tool itself or call it via `node` from a vendored copy.

## API

The gate logic is importable directly — each module takes injectable I/O (filesystem, `git`, `fetch`, clock) so checks are deterministic in tests:

```js
import { checkAllowScripts } from '@aurasec/supply-chain-gates/lib/allow-scripts-gate.mjs';
import { checkRegistry } from '@aurasec/supply-chain-gates/lib/registry-gate.mjs';
import { checkFreshness } from '@aurasec/supply-chain-gates/lib/freshness-gate.mjs';

// each returns { ok: boolean, logs: string[], errors: string[] }
```

## Security

Report vulnerabilities privately via [GitHub security advisories](https://github.com/MdSaifulIslamMSI/Aura/security/advisories) rather than public issues. See the repo's `SECURITY.md`.

## License

[Apache-2.0](./LICENSE)
