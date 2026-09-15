# GitHub Pages Storefront Deployment

Seventh storefront lane (Netlify, Vercel, AWS CloudFront, Render, Railway,
Cloudflare Pages, GitHub Pages). The shared CI artifact is published to the
deployment-dedicated **user-site repo** (`mdsaifulislammsi.github.io`), which
serves at the account root — so the artifact deploys byte-identically with no
base-path rebuild. A project page (`github.io/Aura/`) was rejected because a
sub-path base requires a different build and breaks the byte gate.

## Live service

- URL: `https://mdsaifulislammsi.github.io` (`GH_PAGES_PRODUCTION_URL`).
- Target repo: `mdsaifulislammsi.github.io` (`GH_PAGES_REPO`) —
  deployment-dedicated and public; its history only holds published releases,
  which is what makes rollback a safe restore.
- Pages source: the repo's `main` branch, root directory (branch-based
  publishing). `.nojekyll` is committed by the deploy job so Jekyll never
  processes the tree.
- Routing/headers: GitHub Pages offers no custom header or rewrite config.
  The bundle calls the hosted backend origin directly (same as Netlify/
  Vercel), and GitHub's SPA handling serves `404.html` semantics — the app
  router handles deep links client-side. Security headers other than HSTS
  are not enforceable on github.io; the byte gate and CSP contract therefore
  exclude this host from header parity (its HTML differs by host-injected
  headers only, never content).

## GitHub configuration (one-time)

1. Create the public repo `mdsaifulislammsi.github.io` (empty is fine; the
   deploy job seeds it).
2. Create a fine-grained PAT with **Contents: read and write** on that repo
   only → GitHub secret `GH_PAGES_TOKEN`.
3. Enable Pages: repo Settings → Pages → Source: Deploy from a branch →
   `main` / `/ (root)`.
4. Repo variable `GH_PAGES_REPO` / `GH_PAGES_PRODUCTION_URL` only if
   overriding the defaults.

## Rollback

- Auto: `rollback-github-pages-storefront-on-production-failure` in the
  multi-host workflow and `rollback-frontend-github-pages` in the command
  center run `scripts/rollback-github-pages.sh`.
- Manual: dispatch `production-cicd.yml` with
  `rollback_targets=frontend-multihost` and
  `rollback_refs_json['github-pages']` set to the commit SHA of the user-site
  repo that was live before the bad release.
- Mechanics: the hook removes the current tracked tree and restores the exact
  prior release tree as a revert commit (append-only history, no force-push),
  then pushes. GitHub Pages redeploys the branch automatically.

## What the byte gate checks

`verify_deployed_release_coherence.mjs` fetches
`https://mdsaifulislammsi.github.io` directly and requires the same release
metadata and entry-bundle SHA-256 as the other six hosts. GitHub serves the
published artifact as-is (no Jekyll with `.nojekyll`, no post-processing), so
any mismatch means the pushed tree drifted.
