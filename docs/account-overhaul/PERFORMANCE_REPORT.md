# Account and Profile Overhaul: Performance Report

## Baseline

The audited frontend production build completed in 22.03 seconds.

| Metric | Baseline |
|---|---:|
| Initial JS gzip | 172.97 kB |
| All JS gzip | 4018.08 kB |
| Lazy JS gzip | 3845.11 kB |
| Initial CSS gzip | 59.97 kB |
| Lazy CSS gzip | 5.44 kB |
| Initial payload gzip | 240.35 kB |
| Profile route chunk | 129.66 kB minified / 29.28 kB gzip |
| Support section chunk | 44.83 kB minified / 10.77 kB gzip |
| Largest JS chunk | 929.64 kB minified admin dashboard |

The build budget passed, but Vite reported ineffective dynamic import for an English market pack and chunks above the warning threshold.

## Foundation implementation result

The final implementation build passed the repository bundle budget. Its wall time was observed while focused tests were running in parallel, so build duration is not used as a performance comparison.

| Metric | Baseline | Foundation result | Delta |
|---|---:|---:|---:|
| Initial JS gzip | 172.97 kB | 175.72 kB | +2.75 kB |
| All JS gzip | 4018.08 kB | 4072.79 kB | +54.71 kB |
| Initial CSS gzip | 59.97 kB | 60.29 kB | +0.32 kB |
| Total CSS gzip | Not captured in baseline report | 65.73 kB | Within 66 kB repository cap |
| Initial payload gzip | 240.35 kB | 243.42 kB | +3.07 kB |
| Profile route chunk | 129.66 kB / 29.28 kB gzip | 97.08 kB / 23.07 kB gzip | -6.21 kB gzip |
| Security & Settings chunk | Included in Profile | 43.11 kB / 9.26 kB gzip | Lazy-loaded |

The Account Center shell uses the existing utility layer rather than adding a new route stylesheet. Security & Settings now loads only when selected. Profile-side requests for payments, rewards, trust, MFA, sessions, and intelligence are scoped to relevant sections; the profile/dashboard compatibility read remains shared pending the summary endpoint.

## Current account cost drivers

1. `Profile/index.jsx` still owns broad state across account domains.
2. The shared profile/dashboard compatibility read remains broader than the target summary contract.
3. A 45-second active-window refresh still repeats the shared profile/dashboard read plus the active section's relevant reads.
4. Settings and support remain mixed-responsibility components, although both are isolated lazy chunks.
5. Orders request up to 100 records and do not use continuation.
6. Large global style layers increase CSS parse/match cost and complicate safe removal.
7. The route lacks authenticated network and interaction traces, so runtime latency remains unmeasured.

## Target budgets

Budgets are initial guardrails to be validated against real devices:

| Asset/behavior | Target |
|---|---:|
| Account shell incremental JS | <= 35 kB gzip |
| Any single account feature chunk | <= 45 kB gzip |
| Account-specific CSS | <= 12 kB gzip |
| Initial overview API requests | 1 summary + auth/session prerequisites |
| Inactive feature requests | 0 |
| Default list page | 20–25 records |
| Search debounce | 250–350 ms with request cancellation |
| Interaction blocking | <= 200 ms local guardrail |
| Tap target | >= 44 px |

The repository-wide initial budget remains authoritative; these do not authorize increasing the total budget.

## Performance implementation rules

- Lazy-load feature routes and heavy dialogs.
- Split Settings into security, communications, connected accounts, and privacy modules.
- Split Support into list/detail/create flows.
- Use cursor pagination and windowing only after measurement shows rendering pressure.
- Memoize row components based on measured rerenders, not by default.
- Keep query data normalized enough to update one record without replacing every module.
- Cancel superseded reads and never auto-retry mutations.
- Preload only the next likely route after idle and network allowance.
- Serve responsive product/avatar images with dimensions to prevent layout shift.
- Preserve layout during loading and refetch.

## Required measurements

Authenticated test account evidence:

- cold and warm overview navigation;
- profile/address edit;
- first and second order page;
- Security Center device/session load;
- notification page and mark-read mutation;
- support ticket list;
- mobile 4x CPU slowdown and constrained network;
- request counts, transferred bytes, long tasks, LCP/INP/CLS;
- React profiler for the account shell and long lists.

## Current verification limits

No authenticated local or live performance trace was available. The figures above are verified build artifacts and static data-flow observations, not Core Web Vitals or production latency proof. The repository still reports its pre-existing ineffective English market-pack dynamic import and large admin-dashboard warning.

## Release gate

Record before/after bundle manifests and browser traces on the same hardware/profile. Any regression over 10% in a core task or any account feature chunk above its budget requires an explanation, mitigation, and explicit review.
