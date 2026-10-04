# packages/

Open-source npm packages extracted from this repository, published under the [`@aurasec`](https://www.npmjs.com/org/aurasec) scope. Each package powers production CI here first (dogfooding), so what ships on npm is what actually runs.

| Package | What it does |
| --- | --- |
| [`@aurasec/supply-chain-gates`](./supply-chain-gates) | Fail-closed CI gates: lifecycle-script allowlist, lockfile registry lint, release cooldown. Runs in the `Supply Chain Integrity` CI job. |
| [`@aurasec/route-security-matrix`](./route-security-matrix) | Derives every Express route, requires a declared security posture per mutating route, live-probes unauthenticated requests in CI. Runs in the backend test lanes. |

## Release runbook (maintainer)

One-time setup:

1. **Create the npm org** at <https://www.npmjs.com/org/create> — name it exactly `aurasec`, choose the free public-packages plan, and enable **require two-factor authentication for publishing**.
2. **Configure trusted publishing** (no long-lived tokens): on npmjs.com open each package's settings → *Publishing access* → connect the GitHub repository `MdSaifulIslamMSI/Aura`, workflow `npm-publish.yml`. Do this after the first publish if the package doesn't exist yet — for the first publish either configure the package entry in the org's "pending" settings or set a granular automation token as the `NPM_TOKEN` repository secret and remove it afterwards.
3. Done — no token rotation burden if trusted publishing is used.

Releasing a new version:

```sh
# 1. Bump the version in packages/<name>/package.json, commit to main.
# 2. Tag and push — the tag version must match package.json:
git tag publish-supply-chain-gates-v1.2.3
git push origin publish-supply-chain-gates-v1.2.3
# The npm publish workflow runs tests, then publishes with provenance.
```

Or run the **npm publish** workflow manually from the Actions tab (`workflow_dispatch`, with *dry_run* first to preview).

## Adding a new package

- Directory under `packages/` with its own `package.json` (`name: @aurasec/<pkg>`, `license: Apache-2.0`, `files:` allowlist, `engines: node >=20`).
- Copy `LICENSE` from a sibling package.
- Add the directory to the `npm-publish.yml` `workflow_dispatch` choices and tag patterns.
- Add a row to the table above and a `SECURITY.md` scope bullet when the first release ships.
