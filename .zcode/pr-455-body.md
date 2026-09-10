## Summary

Scales the repository's automated test inventory past the **600-suite milestone** to a verified **TOTAL 601**, delivered as **21 new real, high-signal suites — 187 tests, every one passing** — aimed at the thinnest coverage seams in the codebase. Zero placeholders, zero source changes: this PR is test files + the CI tier manifest only (22 files, +2,031 / −1).

## Why this matters

The inventory stood at 580 suites with measurable gaps concentrated exactly where silent regressions are most expensive: checkout / trade-in / cart / order / listing flows, payment SDK loaders (Stripe, Razorpay), request-proof signing and OTP security clients, and the product-card / prefetch / speech-input UX surface. This PR closes those seams with behavior-driven tests that assert **contracts, not implementation details**, so refactors stay cheap and regressions get caught at the narrowest possible blast radius.

## Coverage map — 21 new suites (187 tests)

### Frontend — 9 files / 71 tests (Vitest)

| Suite | Coverage focus |
|---|---|
| `security/requestProofSigner.test.js` | Request-proof signing contract & edge cases |
| `security/alienOtpClient.test.js` | OTP client behavior, failure & retry semantics |
| `utils/stripe.test.js` | Stripe script-loader lifecycle |
| `utils/razorpay.test.js` | Razorpay script-loader lifecycle |
| `services/api/trustApi.test.js` | Trust API client contract |
| `services/api.test.js` | API barrel export surface |
| `hooks/useSpeechInput.test.jsx` | Speech-input hook states & cleanup |
| `hooks/usePrefetchOracle.test.jsx` | Prefetch-oracle decision logic |
| `components/.../ProductCard.test.jsx` | ProductCard render + interaction contract |

### Backend — 12 files / 116 tests (Jest)

| Suite | Coverage focus |
|---|---|
| `checkoutController.test.js` | Checkout controller routing & error paths |
| `checkoutConfigService.unit.test.js` | Checkout config service, fully mocked |
| `tradeInController.test.js` | Trade-in controller contract |
| `bundleService.test.js` | Bundle resolution logic |
| `orderService.test.js` | Order lifecycle operations |
| `cartService.test.js` | Cart mutations & invariants |
| `listingService.test.js` | Listing pipeline behavior |
| `marketController.test.js` | Market controller surface |
| `userNotificationController.test.js` | Notification delivery paths |
| `productValidators.test.js` | Product input validation guards |
| `uploadValidators.test.js` | Upload input validation guards |
| `publicProductSerializer.test.js` | Public payload serialization safety |

## CI wiring — manifest triage

All 12 new `server/tests` suites are triaged into the **regression tier** and annotated **noDbFiles** (fully mocked / pure, DB-less) in `config/test-tiers.json`, so CI executes them on every run. The pre-existing `checkoutConfigService.test.js` integration suite and its tier entry are **untouched** — the new mocked coverage lives in a separate `checkoutConfigService.unit.test.js`, so no existing triage was disturbed.

## Verification matrix

| Check | Command | Result |
|---|---|---|
| New frontend suites | `npm --prefix app test -- <9 new files>` | ✅ 71/71 passing |
| Lint on new frontend suites | ESLint | ✅ clean |
| New backend suites | `npm --prefix server test -- --runTestsByPath <12 new files> --forceExit` | ✅ 116/116 passing |
| Tier-manifest guard | `node scripts/check-test-tiers.cjs` | ✅ OK — 380 reachable · 120 tiered · 40 workflows drift-free |
| Inventory milestone | `node scripts/test-inventory.mjs` | ✅ **TOTAL 601** (app-unit 191 · app-e2e 9 · server 380 · root-tests 21) |

<details>
<summary>Exact verification commands</summary>

```sh
npm --prefix app test -- src/security/requestProofSigner.test.js src/security/alienOtpClient.test.js src/utils/stripe.test.js src/utils/razorpay.test.js src/services/api/trustApi.test.js src/services/api.test.js src/hooks/useSpeechInput.test.jsx src/hooks/usePrefetchOracle.test.jsx src/components/features/product/ProductCard/ProductCard.test.jsx
npm --prefix server test -- --runTestsByPath tests/checkoutController.test.js tests/checkoutConfigService.unit.test.js tests/tradeInController.test.js tests/bundleService.test.js tests/uploadValidators.test.js tests/publicProductSerializer.test.js tests/productValidators.test.js tests/orderService.test.js tests/cartService.test.js tests/marketController.test.js tests/userNotificationController.test.js tests/listingService.test.js --forceExit
node scripts/check-test-tiers.cjs
node scripts/test-inventory.mjs
```

</details>

## Scope discipline

- **Tests + manifest only** — no source, secret, env, workflow, or generated-file changes anywhere in the diff.
- Pre-existing worktree dirt (`app/public/status-snapshot.*`, `.zcode/`) intentionally left out of this PR.

## Residual risk & rollback

- Full-repo gates (root `npm test` regression tier, full `npm --prefix app test`) were not re-run locally due to runtime; CI exercises them, including all 12 newly tiered suites.
- Rollback if ever needed: `git revert 80952f2` (merge commit). The diff touches no data, config, or migration surface, so a revert is clean and consequence-free outside the test inventory count.
