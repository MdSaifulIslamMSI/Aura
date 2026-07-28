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
5. Large global style layers increase CSS parse/match cost and complicate safe removal.
6. The route lacks authenticated network and interaction traces, so runtime latency remains unmeasured.

## Wave M implementation result

All secondary Account Center sections are now lazy-loaded from the route-state
boundary. Overview and the shell remain in the initial Profile chunk; Personal
Info, Addresses, Orders, Rewards, Payments, Support, Notifications, Settings,
Marketplace and Privacy load only when selected. A stable-dimension suspense
fallback and keyed section error boundary keep loading/failure isolated.

| Metric | Foundation result | Wave M result | Delta |
|---|---:|---:|---:|
| Initial JS gzip | 175.72 kB | 175.97 kB | +0.25 kB |
| All JS gzip | 4,072.79 kB | 4,235.62 kB | +162.83 kB, primarily expanded locale catalogs |
| Initial CSS gzip | 60.29 kB | 60.44 kB | +0.15 kB |
| Total CSS gzip | 65.73 kB | 65.88 kB | +0.15 kB; within 66 kB cap |
| Initial payload gzip | 243.42 kB | 243.82 kB | +0.40 kB |
| Profile route chunk | 23.07 kB gzip | 16.91 kB gzip | -6.16 kB |
| Largest Account feature chunk | 9.26 kB gzip | 11.82 kB gzip (Settings) | Below 45 kB feature cap |

Wave I observed the Profile chunk at 27.04 kB gzip before the complete section
split, making the current route chunk 10.13 kB smaller. Other Account chunks
are 10.76 kB Support, 3.33 kB Addresses, 3.16 kB Payments, 2.99 kB Personal
Info, 2.50 kB Privacy, 2.42 kB Rewards, 2.42 kB Marketplace, 2.37 kB
Notifications and 1.32 kB Orders.

## Wave N measurement overhead

The Account Center now initializes native `PerformanceObserver` collectors only
while the authenticated Profile route is mounted. LCP, INP and CLS are reported
at most once per route lifetime on visibility change, page hide or unmount.
Product events reuse the existing deferred diagnostic buffer and do not create
a synchronous network request on the user-action path.

The post-Wave N production budget remains effectively unchanged at 175.95 kB
initial JS gzip, 65.88 kB total CSS, 60.44 kB initial CSS and 243.80 kB initial
payload.
The Profile chunk is 17.08 kB gzip, a 0.17 kB increase from Wave M and still
12.20 kB below the audited baseline. The largest Account feature is Settings at
11.87 kB gzip, below the 45 kB feature cap. All JS gzip is 4,237.59 kB; the
pre-existing locale/admin cost remains outside the initial route.

These figures prove static bundle cost only. Real p75 LCP/INP/CLS, sample
delivery rate and instrumentation overhead still require authenticated staging
traffic and constrained-device traces.

The production build and repository bundle budget pass. The pre-existing
ineffective English market-pack dynamic import and oversized admin-dashboard
warnings remain outside this scoped Account Center change.

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
